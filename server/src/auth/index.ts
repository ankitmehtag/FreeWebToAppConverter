import bcrypt from 'bcryptjs';
import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { AuthConfig, Mailer } from './types';

export type AuthOptions = { db: Db; redis: Redis; mailer: Mailer; config: AuthConfig };

/** Creates indexes and the dummy hash, and returns what the routes need. */
export const prepareAuth = async ({ db, redis, mailer, config }: AuthOptions) => {
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const emailTokens = db.collection('emailTokens');

  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ googleSub: 1 }, { unique: true, sparse: true });
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await sessions.createIndex({ userId: 1 });
  await emailTokens.createIndex({ hash: 1 }, { unique: true });
  await emailTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // Compared against when no real hash exists, so that unknown emails cost the same.
  const dummyHash = await bcrypt.hash('no-account-has-this-password', config.bcryptCost);

  return { users, sessions, emailTokens, redis, mailer, config, dummyHash };
};

export type Auth = Awaited<ReturnType<typeof prepareAuth>>;
