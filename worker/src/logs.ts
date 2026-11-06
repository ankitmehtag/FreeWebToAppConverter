import type { Redis } from 'ioredis';
import type { Collection } from 'mongodb';
import {
  LIVE_LOG_TTL_SECONDS,
  logChannel,
  logLinesKey,
  logSeqKey,
  MAX_LOG_LINES,
  type BuildEvent,
  type FailureKind,
} from './builds';

const HIDDEN = '[hidden]';
const MIN_SECRET_LENGTH = 4;

// Host paths say where builds run and who runs them. Container paths such as /generated stay.
const HOST_PATH = /(?:\/Users|\/home|\/private|\/var\/folders|\/root|\/tmp|[A-Za-z]:\\)[^\s'"`:,;)]*/g;
// Anything shaped like a credential assignment, whatever its value.
const ASSIGNMENT = /\b([\w.-]*(?:password|passwd|secret|token|access[_-]?key)[\w.-]*\s*[=:]\s*)\S+/gi;
const SECRET_ENV = /KEY|SECRET|PASS|TOKEN|URL/i;

/** Values in our environment that must never reach a user, such as storage keys and database URLs. */
export const environmentSecrets = (env: NodeJS.ProcessEnv = process.env) =>
  Object.entries(env)
    .filter(([name, value]) => SECRET_ENV.test(name) && value && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value!);

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Returns a function that hides the given values, host paths and credential assignments in a line. */
export const redactor = (secrets: string[]) => {
  const values = [...new Set(secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH))].sort((a, b) => b.length - a.length);
  const pattern = values.length ? new RegExp(values.map(escape).join('|'), 'g') : null;
  return (line: string) => {
    const hidden = pattern ? line.replace(pattern, HIDDEN) : line;
    return hidden.replace(HOST_PATH, '[path]').replace(ASSIGNMENT, `$1${HIDDEN}`);
  };
};

export type LogSink = ReturnType<typeof createLogSink>;

/** Streams a build's lines and statuses through Redis, and keeps the lines once it ends. */
export const createLogSink = (redis: Redis, buildLogs: Collection) => ({
  line: async (buildId: string, text: string) => {
    const n = await redis.incr(logSeqKey(buildId));
    const entry = JSON.stringify({ n, text });
    await redis
      .multi()
      .rpush(logLinesKey(buildId), entry)
      .ltrim(logLinesKey(buildId), -MAX_LOG_LINES, -1)
      .expire(logLinesKey(buildId), LIVE_LOG_TTL_SECONDS)
      .expire(logSeqKey(buildId), LIVE_LOG_TTL_SECONDS)
      .exec();
    await redis.publish(logChannel(buildId), JSON.stringify({ type: 'line', n, text } satisfies BuildEvent));
  },

  status: async (buildId: string, status: string, failureKind?: FailureKind) => {
    await redis.publish(logChannel(buildId), JSON.stringify({ type: 'status', status, failureKind } satisfies BuildEvent));
  },

  /** Copies the lines into Mongo. The Redis copy expires by itself, so late viewers still see it meanwhile. */
  finish: async (buildId: string) => {
    const lines = (await redis.lrange(logLinesKey(buildId), 0, -1)).map((entry) => JSON.parse(entry));
    await buildLogs.updateOne({ _id: buildId as never }, { $set: { lines, savedAt: new Date() } }, { upsert: true });
  },
});
