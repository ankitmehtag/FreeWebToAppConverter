import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../src/routes';
import { SessionProvider } from '../src/session';
import { PUBLIC_PAGES } from '../src/site';
import { pendingSite } from '../src/url-check';

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let routes: Record<string, () => Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  calls = [];
  routes = { 'GET /auth/me': () => json({ error: 'Not signed in' }, 401), 'POST /auth/refresh': () => json({}, 401) };
  // Node 25's own localStorage hides jsdom's and needs a file, so tests use one in memory.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
  // Signed-in tests set the CSRF cookie a real session has; signed-out ones leave it unset.
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
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

const Where = () => <span data-testid="where">{`${useLocation().pathname}${useLocation().search}`}</span>;

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <AppRoutes />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;

describe('F11 AC1: public pages', () => {
  it.each(PUBLIC_PAGES.map((page) => page.path))('%s renders signed out and links to every public page', async (path) => {
    open(path);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    const footer = screen.getByRole('navigation', { name: 'Site' });
    const links = within(footer).getAllByRole('link').map((link) => link.getAttribute('href'));
    for (const page of PUBLIC_PAGES.filter((item) => item.path !== '/')) expect(links).toContain(page.path);
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});

describe('F11 AC2: honest plans and the Google Play warning', () => {
  it('states the Free plan’s real limits and marks Premium as coming soon', async () => {
    open('/pricing');
    await screen.findByRole('heading', { name: 'Pricing' });
    for (const text of [/3 builds a day/, /kept for 7 days/, /“Made with” watermark/]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('warns about Google Play on Home and in the FAQ', async () => {
    open('/');
    expect(await screen.findByText(/Google Play can reject an app that only shows a website/)).toBeInTheDocument();
    cleanup();
    open('/faq');
    expect(await screen.findByText(/Google can reject an app that only shows a website/)).toBeInTheDocument();
  });
});

describe('F11 AC3: signed in on Home', () => {
  it('shows Home with a link to the user’s apps', async () => {
    routes['GET /auth/me'] = () => json({ email: 'a@example.com', emailVerified: true });
    document.cookie = 'csrf_token=test; path=/';
    open('/');
    expect(await screen.findByText(/Signed in as a@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Your website, as an Android app/ })).toBeInTheDocument();
    expect(where()).toBe('/');
  });
});

describe('F11 AC4: the site checker on Home', () => {
  const tryUrl = async (url: string) => {
    const user = userEvent.setup();
    open('/');
    await user.type(await screen.findByLabelText('Your website’s address'), url);
    await user.click(screen.getByRole('button', { name: 'Check my site' }));
    return user;
  };

  it.each([
    ['a ready HTTPS site', { reachable: true, https: true, mobileReady: true, embeddable: true }, /Uses HTTPS/],
    ['an HTTP-only site', { reachable: true, https: false, mobileReady: true, embeddable: true }, /Doesn’t use HTTPS yet/],
    ['an unreachable site', { reachable: false, failure: 'unreachable' }, /couldn’t reach that site/],
    ['a refused site', { reachable: false, failure: 'unsafe' }, /list of unsafe sites/],
  ])('shows the result for %s, with no account', async (_name, answer, text) => {
    routes['POST /url/check'] = () => json(answer);
    await tryUrl('example.com');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(calls.find((call) => call.path === '/url/check')?.body).toEqual({ url: 'https://example.com' });
  });

  it('offers to make an app only from a site that passes', async () => {
    routes['POST /url/check'] = () => json({ reachable: true, https: false, mobileReady: true, embeddable: true });
    await tryUrl('plain.example');
    await screen.findByText(/Doesn’t use HTTPS yet/);
    expect(screen.queryByRole('button', { name: /an app$/ })).toBeNull();
  });

  it('says so when there have been too many checks', async () => {
    routes['POST /url/check'] = () => json({ error: 'Too many requests' }, 429);
    await tryUrl('example.com');
    expect(await screen.findByText(/Too many checks/)).toBeInTheDocument();
  });
});

describe('F11 AC5: from Home to the wizard', () => {
  it('keeps a checked site through sign-up, then opens the wizard with it', async () => {
    routes['POST /url/check'] = () => json({ reachable: true, https: true, mobileReady: true, embeddable: false });
    const user = userEvent.setup();
    open('/');
    await user.type(await screen.findByLabelText('Your website’s address'), 'shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Check my site' }));
    await user.click(await screen.findByRole('button', { name: 'Make shop.example.com an app' }));
    expect(where()).toBe('/sign-up');
    expect(pendingSite.get()).toBe('https://shop.example.com');

    // Later, signed in, the apps page turns it into a new app.
    cleanup();
    routes['GET /auth/me'] = () => json({ email: 'a@example.com', emailVerified: true });
    document.cookie = 'csrf_token=test; path=/';
    routes['POST /apps'] = () => json({ id: 'a1' }, 201);
    routes['GET /apps'] = () => json([]);
    open('/my-apps');
    await waitFor(() => expect(where()).toBe('/my-apps/a1/basics?site=https%3A%2F%2Fshop.example.com'));
    expect(pendingSite.get()).toBeUndefined();
  });

  it('fills in and checks the carried site in the wizard', async () => {
    routes['GET /auth/me'] = () => json({ email: 'a@example.com', emailVerified: true });
    document.cookie = 'csrf_token=test; path=/';
    routes['GET /apps/a1'] = () => json({ id: 'a1', draft: {}, ready: false, locked: false, hasIcon: false, createdAt: '', updatedAt: 'v1' });
    routes['POST /url/check'] = () => json({ reachable: true, https: true, mobileReady: true, embeddable: true });
    routes['POST /apps/prefill'] = () => json({ reachable: true });
    routes['PUT /apps/a1'] = () => json({ id: 'a1', draft: {}, ready: false, locked: false, hasIcon: false, createdAt: '', updatedAt: 'v2' });
    open('/my-apps/a1/basics?site=https%3A%2F%2Fshop.example.com');
    const field = await screen.findByRole('textbox', { name: 'Website address' });
    await waitFor(() => expect(field).toHaveValue('https://shop.example.com'));
    await waitFor(() => expect(calls.some((call) => call.path === '/url/check' && call.body?.url === 'https://shop.example.com')).toBe(true));
  });
});

describe('F11 AC6: legal pages and consent', () => {
  it('names the data stored and who processes it', async () => {
    open('/privacy');
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    const text = document.body.textContent ?? '';
    for (const item of ['Cloudflare', 'Resend', 'Google', 'hash of your password', 'APK is\n        kept for 7 days', 'Install links', 'Reports about apps', 'counters keyed by IP address']) {
      expect(text.replace(/\s+/g, ' ')).toContain(item.replace(/\s+/g, ' '));
    }
    expect(screen.getByText(/Draft, last updated/)).toBeInTheDocument();
  });

  it('lists forbidden uses and how to report in the Acceptable Use Policy', async () => {
    open('/acceptable-use');
    await screen.findByRole('heading', { name: 'Acceptable Use Policy' });
    for (const text of [/Phishing/, /Malware/, /Scams/, /Report this app/]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it('names who runs the service in the Terms', async () => {
    open('/terms');
    await screen.findByRole('heading', { name: 'Terms of Service' });
    expect(screen.getAllByText(/Ankit, Gurugram \(Gurgaon\), Haryana, India/).length).toBeGreaterThan(0);
  });

  it('links Terms and Privacy from sign-up, and says signing up accepts the Terms', async () => {
    open('/sign-up');
    expect(await screen.findByText(/By creating an account, you accept the/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});

describe('F11 AC9: a visitor with no session', () => {
  it('asks the API nothing about a session it can’t have', async () => {
    open('/pricing');
    await screen.findByRole('heading', { name: 'Pricing' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call.path.startsWith('/auth/'))).toEqual([]);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
