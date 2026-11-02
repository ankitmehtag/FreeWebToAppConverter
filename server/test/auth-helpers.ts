import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app';
import type { AuthConfig, Mail } from '../src/auth/types';
import { prepareAuth } from '../src/auth';
import type { FetchUrl } from '../src/url/fetcher';

export const APP_URL = 'http://app.test';

export const makeHarness = async (config: Partial<AuthConfig> = {}, fetchUrl?: FetchUrl) => {
  const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
  const db = mongo.db(`auth_test_${randomUUID().slice(0, 8)}`);
  const redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `test:${randomUUID()}:` });
  const sent: Mail[] = [];
  const auth = await prepareAuth({
    db,
    redis,
    mailer: { send: async (mail) => void sent.push(mail) },
    config: {
      jwtSecret: 'test-secret-test-secret-test-secret-test',
      appUrl: APP_URL,
      apiUrl: 'http://api.test',
      bcryptCost: 4,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 86400,
      verifyTtlMs: 60000,
      resetTtlMs: 60000,
      lockThreshold: 5,
      lockMs: 60000,
      ipFailLimit: 1000,
      routeLimit: 1000,
      routeWindowMs: 60000,
      ...config,
    },
  });
  const server: Server = createApp({ checkMongo: async () => {}, checkRedis: async () => {}, auth, fetchUrl }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const client = () => {
    const cookies = new Map<string, string>();
    const raw: string[] = [];
    const send = async (path: string, init: RequestInit & { csrf?: string | null; headers?: Record<string, string> } = {}) => {
      const { csrf, ...rest } = init;
      const headers: Record<string, string> = { ...rest.headers };
      headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      const token = csrf === undefined ? cookies.get('csrf_token') : csrf;
      if (token) headers['x-csrf-token'] = token;
      const response = await fetch(`${url}${path}`, { redirect: 'manual', ...rest, headers });
      for (const header of response.headers.getSetCookie()) {
        raw.push(header);
        const [pair] = header.split(';');
        const [name, value] = pair!.split('=');
        if (value) cookies.set(name!, value);
        else cookies.delete(name!);
      }
      return response;
    };
    return {
      cookies,
      raw,
      get: (path: string, options = {}) => send(path, options),
      post: (path: string, body?: unknown, options: { csrf?: string | null; headers?: Record<string, string> } = {}) =>
        send(path, {
          method: 'POST',
          ...options,
          headers: { 'content-type': 'application/json', ...options.headers },
          body: JSON.stringify(body ?? {}),
        }),
    };
  };

  const tokenIn = (mail: Mail) => /token=([\w-]+)/.exec(mail.text)?.[1] ?? '';
  const mailTo = async (to: string) => {
    for (let i = 0; i < 40; i += 1) {
      const mail = sent.findLast((item) => item.to === to);
      if (mail) return mail;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No mail for ${to}`);
  };

  return {
    url, client, sent, mailTo, tokenIn, db, redis,
    users: db.collection('users'),
    sessions: db.collection('sessions'),
    emailTokens: db.collection('emailTokens'),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.dropDatabase();
      await mongo.close();
      redis.disconnect();
    },
  };
};

export const PASSWORD = 'correct-horse-battery';

export const signedIn = async (harness: Awaited<ReturnType<typeof makeHarness>>, email = 'user@example.com') => {
  const user = harness.client();
  await user.post('/auth/register', { email, password: PASSWORD });
  await user.post('/auth/login', { email, password: PASSWORD });
  return user;
};
