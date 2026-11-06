import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildPanel } from '../src/build-panel';
import { BuildPage, type BuildView } from '../src/pages/build';
import { InstallPage } from '../src/pages/install';

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let routes: Record<string, () => Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Stands in for the browser's EventSource, so tests can push events. */
class FakeSource {
  static last: FakeSource;
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, data: unknown) {
    act(() => this.listeners[type]?.forEach((listener) => listener(new MessageEvent(type, { data: JSON.stringify(data) }))));
  }
  close() {
    this.closed = true;
  }
}

const build = (fields: Partial<BuildView> = {}): BuildView => ({
  id: 'b1', appId: 'a1', status: 'building', versionCode: 3, versionName: '1.2', expired: false, createdAt: '2026-11-06T10:00:00Z', ...fields,
});

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return routes[`${method} ${path}`]?.() ?? json({}, 404);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (path: string, pattern: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<p>Elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('F09 build panel', () => {
  const panel = (props: Partial<Parameters<typeof BuildPanel>[0]> = {}) =>
    at('/r', '/r', <BuildPanel appId="a1" emailVerified {...props} />);

  it('sends one key per attempt with the chosen version name', async () => {
    routes['POST /apps/a1/builds'] = () => json(build({ status: 'queued' }), 201);
    const user = userEvent.setup();
    panel();
    const version = screen.getByRole('textbox', { name: 'Version name' });
    await user.clear(version);
    await user.type(version, '2.0');
    await user.dblClick(screen.getByRole('button', { name: 'Build app' }));
    await screen.findByText('Elsewhere');
    const starts = calls.filter((call) => call.path === '/apps/a1/builds');
    expect(new Set(starts.map((call) => call.body?.idempotencyKey)).size).toBe(1);
    expect(starts[0]?.body?.versionName).toBe('2.0');
  });

  it('says when the next build is allowed after the daily limit', async () => {
    routes['POST /apps/a1/builds'] = () => json({ error: 'limit', reason: 'daily_limit', nextAllowedAt: '2026-11-07T10:00:00Z' }, 429);
    panel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Build app' }));
    expect(await screen.findByText(/used your 3 builds/)).toBeInTheDocument();
  });

  it('won’t start a second build while one runs, and refuses a bad version', async () => {
    panel({ latest: build({ status: 'building' }) });
    expect(screen.getByRole('button', { name: 'Build app' })).toBeDisabled();
    cleanup();
    panel();
    const user = userEvent.setup();
    const version = screen.getByRole('textbox', { name: 'Version name' });
    await user.clear(version);
    await user.type(version, '1.0-beta');
    expect(screen.getByRole('button', { name: 'Build app' })).toBeDisabled();
  });

  it('asks an unverified user to confirm their email first', () => {
    panel({ emailVerified: false });
    expect(screen.getByText(/Confirm your email to build/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build app' })).toBeNull();
  });
});

describe('F09 AC6, AC8: the build page', () => {
  const page = () => at('/my-apps/a1/builds/b1', '/my-apps/:id/builds/:buildId', <BuildPage />);

  it('adds live lines once each, and follows the status', async () => {
    let current = build();
    routes['GET /builds/b1'] = () => json(current);
    routes['GET /apps/a1/builds'] = () => json([current]);
    page();
    await screen.findByText('Building', { selector: '.tag' });
    expect(FakeSource.last.url).toBe('/builds/b1/events');
    FakeSource.last.emit('line', { n: 1, text: 'Task :app:preBuild' });
    FakeSource.last.emit('line', { n: 2, text: 'BUILD SUCCESSFUL' });
    FakeSource.last.emit('line', { n: 1, text: 'Task :app:preBuild' });
    expect(screen.getByLabelText('Build log').textContent).toBe('Task :app:preBuild\nBUILD SUCCESSFUL\n');

    current = build({ status: 'success', artifactBytes: 2_726_033, sha256: 'ab'.repeat(32), expiresAt: '2026-11-13T10:00:00Z' });
    FakeSource.last.emit('status', { type: 'status', status: 'success' });
    FakeSource.last.emit('end', {});
    expect(await screen.findByRole('link', { name: 'Download APK' })).toHaveAttribute('href', '/builds/b1/download');
    expect(FakeSource.last.closed).toBe(true);
  });

  it.each([
    ['infra', /failed on our side/],
    ['timeout', /longer than 15 minutes/],
    ['input', /couldn’t use this app’s settings/],
  ])('explains a %s failure', async (failureKind, text) => {
    routes['GET /builds/b1'] = () => json(build({ status: 'failed', failureKind: failureKind as BuildView['failureKind'] }));
    page();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('offers a new build when the APK has expired', async () => {
    routes['GET /builds/b1'] = () => json(build({ status: 'success', expired: true }));
    page();
    expect(await screen.findByRole('link', { name: 'Start a new build' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download APK' })).toBeNull();
  });

  it('draws the install QR code here, from the link the API made', async () => {
    routes['GET /builds/b1'] = () => json(build({ status: 'success', artifactBytes: 1000, sha256: 'cd'.repeat(32), expiresAt: '2026-11-13T10:00:00Z' }));
    routes['POST /builds/b1/install-link'] = () => json({ url: 'http://app.test/install/tok', expiresAt: '2026-11-06T11:00:00Z' }, 201);
    page();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Install on a phone' }));
    const qr = await screen.findByAltText('QR code for the install page');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole('link', { name: 'http://app.test/install/tok' })).toBeInTheDocument();
    expect(calls.every((call) => call.path.startsWith('/'))).toBe(true);
  });
});

describe('F09 AC10: the install page', () => {
  const page = () => at('/install/tok', '/install/:token', <InstallPage />);

  it('shows the app and its download without an account', async () => {
    routes['GET /builds/install/tok'] = () => json({ appName: 'Proof Shop', versionName: '1.0', versionCode: 1, artifactBytes: 2_726_033 });
    page();
    expect(await screen.findByRole('heading', { name: 'Proof Shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the app' })).toHaveAttribute('href', '/builds/install/tok/download');
    expect(screen.getByText(/2\.6 MB/)).toBeInTheDocument();
  });

  it('doesn’t call a busy server an expired link', async () => {
    routes['GET /builds/install/tok'] = () => json({ error: 'Too many requests' }, 429);
    page();
    expect(await screen.findByRole('heading', { name: 'Too many tries' })).toBeInTheDocument();
  });

  it('says an expired link has expired', async () => {
    routes['GET /builds/install/tok'] = () => json({ error: 'gone' }, 410);
    page();
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
  });
});
