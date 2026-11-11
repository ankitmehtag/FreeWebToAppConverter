import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Collection, Db, ObjectId } from 'mongodb';

/** Premium signing keys, sealed with AES-256-GCM so the database never holds one in the clear. */

export type Keyring = { active: { id: string; key: Buffer }; byId: Map<string, Buffer> };

export type Sealed = { keyId: string; iv: Buffer; tag: Buffer; data: Buffer };

export type KeystoreSecrets = { alias: string; storePassword: string; keyPassword: string; keystore: Buffer };

export type Fingerprints = { sha1: string; sha256: string };

const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * Reads `KEYSTORE_MASTER_KEY`: one or more `id:base64` entries, comma separated. The first seals new records,
 * and every entry can open old ones, so the key can be replaced by putting a new one in front.
 */
export const parseKeyring = (value: string | undefined): Keyring => {
  const entries = (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error('KEYSTORE_MASTER_KEY is not set');
  const byId = new Map<string, Buffer>();
  for (const entry of entries) {
    const split = entry.indexOf(':');
    if (split < 1) throw new Error('KEYSTORE_MASTER_KEY entries must look like id:base64');
    const id = entry.slice(0, split);
    const key = Buffer.from(entry.slice(split + 1), 'base64');
    if (key.length !== KEY_BYTES) throw new Error(`KEYSTORE_MASTER_KEY entry ${id} must be ${KEY_BYTES} bytes`);
    if (byId.has(id)) throw new Error(`KEYSTORE_MASTER_KEY lists key id ${id} twice`);
    byId.set(id, key);
  }
  const [id, key] = [...byId][0]!;
  return { active: { id, key }, byId };
};

/** The app id is authenticated with the data, so a record moved to another app fails to open. */
export const seal = (ring: Keyring, plaintext: Buffer, appId: string): Sealed => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', ring.active.key, iv);
  cipher.setAAD(Buffer.from(appId));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { keyId: ring.active.id, iv, tag: cipher.getAuthTag(), data };
};

export const open = (ring: Keyring, sealed: Sealed, appId: string): Buffer => {
  const key = ring.byId.get(sealed.keyId);
  if (!key) throw new Error(`No master key with id ${sealed.keyId}`);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAAD(Buffer.from(appId));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.data), decipher.final()]);
};

export type KeystoreRecord = {
  appId: ObjectId;
  ownerId?: ObjectId;
  /** Backup reminder emails sent so far: one a day after the key is made, one after a week. */
  remindersSent: number;
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
  sha1: string;
  sha256: string;
  createdAt: Date;
  downloadedAt: Date | null;
  deleteAfter: Date | null;
  /** Set once the owner has been told the key will be erased. */
  eraseNoticeSent?: boolean;
  /** Set when the purchase is refunded or lost in a dispute: the key can no longer be downloaded. */
  revokedAt?: Date | null;
};

export type Keystores = Collection<KeystoreRecord>;

/** One keystore per app, enforced by the index so parallel builds cannot make two. */
export const prepareKeystores = async (db: Db): Promise<Keystores> => {
  const keystores = db.collection<KeystoreRecord>('keystores');
  await keystores.createIndex({ appId: 1 }, { unique: true });
  return keystores;
};

const pack = (secrets: KeystoreSecrets) =>
  Buffer.from(
    JSON.stringify({
      alias: secrets.alias,
      storePassword: secrets.storePassword,
      keyPassword: secrets.keyPassword,
      keystore: secrets.keystore.toString('base64'),
    }),
  );

/** Stores the keystore if the app has none yet. Answers whether this call stored it. */
export const createKeystoreOnce = async (
  keystores: Keystores,
  ring: Keyring,
  appId: ObjectId,
  secrets: KeystoreSecrets,
  fingerprints: Fingerprints,
  ownerId?: ObjectId,
): Promise<boolean> => {
  const sealed = seal(ring, pack(secrets), String(appId));
  const result = await keystores.updateOne(
    { appId },
    {
      $setOnInsert: {
        appId,
        ...(ownerId ? { ownerId } : {}),
        remindersSent: 0,
        ...sealed,
        ...fingerprints,
        createdAt: new Date(),
        downloadedAt: null,
        deleteAfter: null,
      },
    },
    { upsert: true },
  );
  return result.upsertedCount === 1;
};

export const readKeystore = async (
  keystores: Keystores,
  ring: Keyring,
  appId: ObjectId,
): Promise<(Fingerprints & { secrets: KeystoreSecrets }) | null> => {
  const record = await keystores.findOne({ appId });
  if (!record) return null;
  const sealed: Sealed = {
    keyId: record.keyId,
    iv: Buffer.from(record.iv.buffer ?? record.iv),
    tag: Buffer.from(record.tag.buffer ?? record.tag),
    data: Buffer.from(record.data.buffer ?? record.data),
  };
  const parsed = JSON.parse(open(ring, sealed, String(appId)).toString()) as Omit<KeystoreSecrets, 'keystore'> & { keystore: string };
  return {
    sha1: record.sha1,
    sha256: record.sha256,
    secrets: { ...parsed, keystore: Buffer.from(parsed.keystore, 'base64') },
  };
};

export const ERASE_GRACE_DAYS = 7;

/** Starts the 7-day wait before a key is erased. A second call keeps the first date. */
export const scheduleErase = async (keystores: Keystores, filter: Partial<Pick<KeystoreRecord, 'appId' | 'ownerId'>>, now = new Date()) => {
  const when = new Date(now.getTime() + ERASE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const result = await keystores.updateMany({ ...filter, deleteAfter: null }, { $set: { deleteAfter: when } });
  return result.modifiedCount;
};

/** Erases the keys whose wait is over. */
export const eraseDue = async (keystores: Keystores, now = new Date()) =>
  (await keystores.deleteMany({ deleteAfter: { $ne: null, $lte: now } })).deletedCount;

/** `AA:BB:CC` as `aabbcc`, the form `apksigner` prints. */
export const plainHex = (fingerprint: string) => fingerprint.replaceAll(':', '').toLowerCase();
