import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export const base32 = (bytes: Buffer) => {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? []).map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
};

const fromBase32 = (text: string) => {
  const bits = [...text].map((char) => ALPHABET.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
};

export const newSecret = () => base32(randomBytes(20));

const codeAt = (secret: string, counter: number) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', fromBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
};

/** The current code, plus the step before and after for clock drift. Returns the step that matched, so a code can't be used twice. */
export const checkCode = (secret: string, code: string, now = Date.now()): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const candidate of [step, step - 1, step + 1]) if (codeAt(secret, candidate) === code) return candidate;
  return null;
};

export const codeNow = (secret: string, now = Date.now()) => codeAt(secret, Math.floor(now / 1000 / STEP_SECONDS));

export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/WebToApp%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('WebToApp Admin')}`;

/** The stored secret is encrypted with a key derived from the server's JWT secret, so a database copy alone can't mint codes. */
const keyFor = (jwtSecret: string) => createHash('sha256').update(`admin-totp:${jwtSecret}`).digest();

export const seal = (jwtSecret: string, secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(jwtSecret), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
};

export const unseal = (jwtSecret: string, sealed: string) => {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', keyFor(jwtSecret), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8');
};
