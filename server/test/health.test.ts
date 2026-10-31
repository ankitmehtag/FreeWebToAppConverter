import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const up = async () => {};
const down = async () => {
  throw new Error('connect failed for mongodb://admin:s3cret@db.internal:27017');
};

let server: Server;

const getHealth = async (checkMongo: () => Promise<void>, checkRedis: () => Promise<void>) => {
  server = createApp({ checkMongo, checkRedis, checkTimeoutMs: 50 }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return { status: response.status, text: await response.text() };
};

afterEach(() => server.close());

describe('GET /health', () => {
  it('AC5: returns 200 when both are up', async () => {
    const { status, text } = await getHealth(up, up);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ status: 'ok', mongo: 'up', redis: 'up' });
  });

  it('AC6: returns 503 when Redis is down', async () => {
    const { status, text } = await getHealth(up, down);
    expect(status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: 'degraded', mongo: 'up', redis: 'down' });
  });

  it('AC7: returns 503 when MongoDB is down', async () => {
    const { status, text } = await getHealth(down, up);
    expect(status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: 'degraded', mongo: 'down', redis: 'up' });
  });

  it('AC6, AC7: treats a hanging check as down', async () => {
    const hang = () => new Promise<void>(() => {});
    const { status, text } = await getHealth(hang, up);
    expect(status).toBe(503);
    expect(JSON.parse(text).mongo).toBe('down');
  });

  it('AC8: never exposes the failure detail', async () => {
    const { text } = await getHealth(down, down);
    expect(text).not.toMatch(/mongodb:|s3cret|db\.internal/);
  });
});
