import { createHash, randomBytes } from 'node:crypto';
import type { Document, ObjectId } from 'mongodb';
import type { Resellers } from './index';

export const MAX_ACTIVE_KEYS = 10;
const PREFIX = 'rk_';

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

/** Makes a key. Only its hash is stored, so the clear text exists in this one return value. */
export const createKey = async ({ keys }: Resellers, resellerId: ObjectId, name: string) => {
  const key = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  const { insertedId } = await keys.insertOne({ resellerId, name, hash: hashOf(key), prefix: key.slice(0, 8), createdAt: new Date() });
  return { id: insertedId, key, prefix: key.slice(0, 8) };
};

export const activeKeyCount = ({ keys }: Resellers, resellerId: ObjectId) => keys.countDocuments({ resellerId, revokedAt: { $exists: false } });

export const keyView = (key: Document) => ({ id: String(key._id), name: key.name as string, prefix: key.prefix as string, createdAt: key.createdAt as Date, lastUsedAt: (key.lastUsedAt as Date | undefined) ?? null, revoked: Boolean(key.revokedAt) });

export const revokeKey = async ({ keys }: Resellers, resellerId: ObjectId, keyId: ObjectId) => {
  const { matchedCount } = await keys.updateOne({ _id: keyId, resellerId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  return matchedCount === 1;
};

/** The live key a bearer header names, or null. A revoked key never matches. */
export const findKey = async ({ keys }: Resellers, header: string | undefined) => {
  const match = /^Bearer (rk_[A-Za-z0-9_-]{43})$/.exec(header ?? '');
  return match ? keys.findOneAndUpdate({ hash: hashOf(match[1]!), revokedAt: { $exists: false } }, { $set: { lastUsedAt: new Date() } }) : null;
};
