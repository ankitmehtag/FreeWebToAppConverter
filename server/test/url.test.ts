import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isPublicAddress } from '../src/url/address';
import { createFetcher, FetchFailure, type FetcherOptions } from '../src/url/fetcher';
import { makeHarness } from './auth-helpers';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let site: Server;
let port: number;
let handler: Handler;
let requests: IncomingMessage[];

beforeAll(async () => {
  site = createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => site.once('listening', resolve));
  port = (site.address() as AddressInfo).port;
});

afterAll(() => {
  site.closeAllConnections();
  site.close();
});

afterEach(() => {
  requests = [];
  handler = (_req, res) => res.end('ok');
});

requests = [];
handler = (_req, res) => res.end('ok');

/** Treats only the local test server as public, so the real rule judges everything else. */
const localFetcher = (records: Record<string, string[]>, options: FetcherOptions = {}) => {
  const lookups: string[] = [];
  const fetchUrl = createFetcher({
    resolve: async (host) => {
      lookups.push(host);
      return (records[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
    isAllowedAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
    ports: [80, 443, port],
    ...options,
  });
  return { fetchUrl, lookups };
};

const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FetchFailure);
  return (error as FetchFailure).code;
};

describe('address rule', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '169.254.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::7f00:1',
    '64:ff9b::a00:1',
    '64:ff9b:1::808:808',
    '2002:a9fe:a9fe::1',
    '2001::1',
    '4000::1',
    'not an address',
  ])('AC3: refuses %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '2606:4700:4700::1111', '2a00:1450:4001::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '64:ff9b::689a:5969'])(
    'AC3: allows %s',
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
});

describe('URL rules', () => {
  it.each(['ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'data:text/plain,hi', 'https://example.com:8443/', 'http://example.com:22/', 'https://user:pass@example.com/', 'https://user@example.com/'])(
    'AC1: refuses %s before any lookup',
    async (url) => {
      const { fetchUrl, lookups } = localFetcher({ 'example.com': ['127.0.0.1'] });
      expect(await failure(fetchUrl(url))).toBe('blocked');
      expect(lookups).toEqual([]);
    },
  );

  it('AC1: answers invalid_url for text that is no URL', async () => {
    const { fetchUrl } = localFetcher({});
    expect(await failure(fetchUrl('not a url'))).toBe('invalid_url');
  });

  it.each(['2130706433', '0177.0.0.1', '0x7f.1', '127.1', '0x7f000001', '[::ffff:127.0.0.1]', '[::1]', '[::ffff:7f00:1]'])(
    'AC2: refuses http://%s/ with no lookup or connection',
    async (host) => {
      const fetchUrl = createFetcher();
      expect(await failure(fetchUrl(`http://${host}/`))).toBe('blocked');
      expect(requests).toHaveLength(0);
    },
  );

  it.each(['10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe'])(
    'AC3: refuses a host resolving to %s',
    async (address) => {
      const { fetchUrl } = localFetcher({ 'evil.test': [address] });
      expect(await failure(fetchUrl(`http://evil.test:${port}/`))).toBe('blocked');
      expect(requests).toHaveLength(0);
    },
  );

  it('AC4: refuses a host with one public and one private address', async () => {
    const { fetchUrl } = localFetcher({ 'mixed.test': ['127.0.0.1', '10.0.0.1'] });
    expect(await failure(fetchUrl(`http://mixed.test:${port}/`))).toBe('blocked');
    expect(requests).toHaveLength(0);
  });

  it('AC3: accepts a site whose DNS64 answer is a NAT64 form of its public address', async () => {
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1', '64:ff9b::689a:5969'] });
    const response = await fetchUrl(`http://site.test:${port}/`);
    expect(response.body.toString()).toBe('ok');
  });

  it('answers unreachable when a host does not resolve', async () => {
    const { fetchUrl } = localFetcher({});
    expect(await failure(fetchUrl(`http://nowhere.test:${port}/`))).toBe('unreachable');
  });
});

describe('fetching', () => {
  it('AC5: connects to the address it checked, with one lookup', async () => {
    let calls = 0;
    const fetchUrl = createFetcher({
      resolve: async () => {
        calls += 1;
        return [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.1', family: 4 }];
      },
      isAllowedAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
      ports: [port],
    });
    const response = await fetchUrl(`http://rebind.test:${port}/`);
    expect(response.body.toString()).toBe('ok');
    expect(calls).toBe(1);
    expect(requests[0]!.headers.host).toBe(`rebind.test:${port}`);
  });

  it('connects over IPv4 when a host answers with IPv6 first, and every address still has to pass', async () => {
    const fetchUrl = createFetcher({
      resolve: async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ],
      isAllowedAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
      ports: [port],
    });
    expect((await fetchUrl(`http://dual.test:${port}/`)).body.toString()).toBe('ok');
    const blocked = createFetcher({
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '::1', family: 6 },
      ],
      ports: [port],
    });
    expect(await failure(blocked(`http://dual.test:${port}/`))).toBe('blocked');
  });

  it('AC7: refuses a redirect to the metadata address at that hop', async () => {
    handler = (_req, res) => res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] });
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('blocked');
    expect(requests).toHaveLength(1);
  });

  it('AC7: refuses a redirect to a private host and to a blocked scheme', async () => {
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'], 'inner.test': ['192.168.0.5'] });
    handler = (_req, res) => res.writeHead(301, { location: `http://inner.test:${port}/` }).end();
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('blocked');
    handler = (_req, res) => res.writeHead(301, { location: 'file:///etc/passwd' }).end();
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('blocked');
  });

  const chain: Handler = (req, res) => {
    const left = Number(req.url?.slice(1));
    if (left === 0) res.end('end');
    else res.writeHead(302, { location: `/${left - 1}` }).end();
  };

  it('AC7: follows 5 redirects, and reports the final URL', async () => {
    handler = chain;
    const { fetchUrl, lookups } = localFetcher({ 'site.test': ['127.0.0.1'] });
    const response = await fetchUrl(`http://site.test:${port}/5`);
    expect(response.body.toString()).toBe('end');
    expect(response.url).toBe(`http://site.test:${port}/0`);
    expect(lookups).toHaveLength(6);
  });

  it('AC7: refuses a 6th redirect', async () => {
    handler = chain;
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] });
    expect(await failure(fetchUrl(`http://site.test:${port}/6`))).toBe('blocked');
    expect(requests).toHaveLength(6);
  });

  it('AC8: stops a stalled server at the deadline, and closes the connection', async () => {
    let closed: () => void;
    const socketClosed = new Promise<void>((resolve) => (closed = resolve));
    handler = (req) => req.socket.once('close', closed);
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] }, { timeoutMs: 100 });
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('timeout');
    await socketClosed;
  });

  it('AC8: the deadline covers a server that trickles and a slow lookup', async () => {
    handler = (_req, res) => {
      res.write('x');
      const timer = setInterval(() => res.write('x'), 10);
      res.once('close', () => clearInterval(timer));
    };
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] }, { timeoutMs: 100 });
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('timeout');

    const slowDns = createFetcher({ resolve: () => new Promise(() => {}), timeoutMs: 50 });
    expect(await failure(slowDns('http://slow.test/'))).toBe('timeout');
  });

  it('AC8: stops at the size limit, and closes the connection', async () => {
    let closed: () => void;
    const socketClosed = new Promise<void>((resolve) => (closed = resolve));
    handler = (req, res) => {
      req.socket.once('close', closed);
      res.write(Buffer.alloc(4096));
      res.write(Buffer.alloc(4096));
    };
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] }, { maxBytes: 1024 });
    expect(await failure(fetchUrl(`http://site.test:${port}/`))).toBe('too_large');
    await socketClosed;
  });

  it('AC8: asks for plain content, and does not expand a compressed response', async () => {
    const raw = gzipSync(Buffer.alloc(1024 * 1024));
    handler = (_req, res) => res.writeHead(200, { 'content-encoding': 'gzip' }).end(raw);
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] });
    const response = await fetchUrl(`http://site.test:${port}/`);
    expect(response.body.equals(raw)).toBe(true);
    expect(requests[0]!.headers['accept-encoding']).toBe('identity');
  });

  it('AC9: ignores proxy settings, and sends no cookie or internal header', async () => {
    let proxied = 0;
    const proxy = createServer((_req, res) => {
      proxied += 1;
      res.end('proxied');
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => proxy.once('listening', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    process.env.HTTP_PROXY = proxyUrl;
    process.env.http_proxy = proxyUrl;
    try {
      const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'] });
      const response = await fetchUrl(`http://site.test:${port}/`);
      expect(response.body.toString()).toBe('ok');
      expect(proxied).toBe(0);
      expect(Object.keys(requests[0]!.headers).sort()).toEqual(['accept', 'accept-encoding', 'connection', 'host', 'user-agent']);
    } finally {
      delete process.env.HTTP_PROXY;
      delete process.env.http_proxy;
      proxy.close();
    }
  });
});

describe('POST /url/check', () => {
  const makeChecker = async (routeLimit = 1000, options: FetcherOptions = {}) => {
    const { fetchUrl } = localFetcher({ 'site.test': ['127.0.0.1'], 'inner.test': ['10.0.0.1'] }, options);
    const harness = await makeHarness({ routeLimit }, fetchUrl);
    harnesses.push(harness);
    const check = async (body: unknown) => {
      const response = await fetch(`${harness.url}/url/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    };
    return check;
  };

  const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  });

  const page = (head: string, headers: Record<string, string> = {}): Handler => (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html', ...headers }).end(`<html><head>${head}</head></html>`);

  const VIEWPORT = '<meta charset="utf-8"><META content="width=device-width" NAME=\'viewport\'>';

  it('AC10: reports a mobile ready site that allows embedding', async () => {
    handler = page(VIEWPORT);
    const check = await makeChecker();
    const { status, text } = await check({ url: `http://site.test:${port}/` });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ reachable: true, https: false, mobileReady: true, embeddable: true });
  });

  it('AC10: reports a page with no viewport tag', async () => {
    handler = page('<meta name="description" content="viewport">');
    const check = await makeChecker();
    expect(JSON.parse((await check({ url: `http://site.test:${port}/` })).text).mobileReady).toBe(false);
  });

  it('AC10: answers unknown when the server compresses anyway', async () => {
    handler = page(VIEWPORT, { 'content-encoding': 'gzip' });
    const check = await makeChecker();
    expect(JSON.parse((await check({ url: `http://site.test:${port}/` })).text).mobileReady).toBe('unknown');
  });

  it('AC10: reads a hostile page of unclosed tags quickly', async () => {
    const hostile = `${'<meta name '.repeat(150000)}`;
    handler = (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(hostile);
    const check = await makeChecker();
    const started = Date.now();
    expect(JSON.parse((await check({ url: `http://site.test:${port}/` })).text).mobileReady).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([
    [{ 'x-frame-options': 'DENY' }, false],
    [{ 'x-frame-options': 'SAMEORIGIN' }, false],
    [{ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }, false],
    [{ 'content-security-policy': 'frame-ancestors https://only.example' }, false],
    [{ 'content-security-policy': "default-src 'self'" }, true],
    [{ 'content-security-policy': 'frame-ancestors *' }, true],
    [{ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }, true],
    [{ 'content-security-policy': 'FRAME-ANCESTORS https:' }, true],
  ])('AC10: reads %j as embeddable %s', async (headers, embeddable) => {
    handler = page(VIEWPORT, headers as Record<string, string>);
    const check = await makeChecker();
    expect(JSON.parse((await check({ url: `http://site.test:${port}/` })).text).embeddable).toBe(embeddable);
  });

  it('AC11: answers with the failure code alone', async () => {
    const check = await makeChecker(1000, { timeoutMs: 200, maxBytes: 64 });
    const expectFailure = async (url: string, code: string) => {
      const { status, text } = await check({ url });
      expect(status).toBe(200);
      expect(JSON.parse(text)).toEqual({ reachable: false, failure: code });
      expect(text).not.toMatch(/10\.0\.0\.1|127\.0\.0\.1|ECONN|secret-body/);
    };

    await expectFailure('not a url', 'invalid_url');
    await expectFailure(`http://inner.test:${port}/`, 'blocked');
    await expectFailure(`http://missing.test:${port}/`, 'unreachable');
    handler = (_req, res) => res.writeHead(500).end('secret-body');
    await expectFailure(`http://site.test:${port}/`, 'unreachable');
    handler = () => {};
    await expectFailure(`http://site.test:${port}/`, 'timeout');
    handler = (_req, res) => res.end('secret-body'.repeat(100));
    await expectFailure(`http://site.test:${port}/`, 'too_large');
  });

  it('AC12: answers 429 after the limit', async () => {
    const check = await makeChecker(10);
    const answers = [];
    for (let i = 0; i < 11; i += 1) answers.push((await check({ url: `http://site.test:${port}/` })).status);
    expect(answers.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(answers[10]).toBe(429);
  });

  it.each([[{ url: 5 }], [{ url: ['x'] }], [{}], [{ url: 'https://example.com/', extra: 1 }], [{ url: 'x'.repeat(2049) }]])(
    'AC12: refuses %j',
    async (body) => {
      const check = await makeChecker();
      expect((await check(body)).status).toBe(400);
    },
  );
});
