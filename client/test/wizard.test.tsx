import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft } from '@sitetoapk/shared';
import { PhonePreview } from '../src/preview';
import { Wizard } from '../src/pages/wizard';
import { SessionProvider } from '../src/session';

type Call = { method: string; path: string; body?: unknown };
let calls: Call[];
let stored: { draft: Draft; hasIcon: boolean; locked: boolean; ready?: boolean; takenDown?: { reason: string; at: string } };
let urlCheck: unknown;

const view = () => ({ id: 'a1', ready: false, createdAt: '', updatedAt: 'v1', ...stored });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  calls = [];
  stored = { draft: {}, hasIcon: false, locked: false };
  urlCheck = { reachable: true, https: true, mobileReady: true, embeddable: true };
  sessionStorage.clear();
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === '/auth/me') return json({ email: 'a@example.com', emailVerified: true });
    if (path === '/apps/a1' && method === 'GET') return json(view());
    if (path === '/apps/a1' && method === 'PUT') {
      stored.draft = body;
      return json(view());
    }
    if (path === '/url/check') return json(urlCheck);
    if (path === '/apps/prefill') return json({ reachable: true, appName: 'Example Shop' });
    return json({}, 404);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (step: string) =>
  render(
    <MemoryRouter initialEntries={[`/my-apps/a1/${step}`]}>
      <SessionProvider>
        <Routes>
          <Route path="/my-apps/:id/:step?" element={<Wizard />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );

const puts = () => calls.filter((call) => call.method === 'PUT');

describe('AC8: the draft survives a refresh', () => {
  it('opens on the step in the address, with the saved values', async () => {
    stored.draft = { startUrl: 'https://example.com/', appName: 'Saved name', ui: { zoom: true, pullToRefresh: false } };
    open('behaviour');
    expect(await screen.findByRole('checkbox', { name: /Pinch to zoom/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Pull to refresh/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^3\s?Behaviour$/ })).toHaveAttribute('aria-current', 'step');
  });

  it('saves edits by itself, and a remount shows them', async () => {
    stored.draft = { startUrl: 'https://example.com/', appName: 'Old' };
    const user = userEvent.setup();
    open('basics');
    const name = await screen.findByRole('textbox', { name: 'App name' });
    await user.clear(name);
    await user.type(name, 'New name');
    await waitFor(() => expect(puts().at(-1)?.body).toMatchObject({ appName: 'New name' }), { timeout: 2000 });

    cleanup();
    open('basics');
    expect(await screen.findByRole('textbox', { name: 'App name' })).toHaveValue('New name');
  });

  it('does not save a value the rules refuse, and says so', async () => {
    stored.draft = { startUrl: 'https://example.com/', packageName: 'com.example.app' };
    const user = userEvent.setup();
    open('basics');
    const field = await screen.findByRole('textbox', { name: 'Package name' });
    await user.clear(field);
    await user.type(field, 'com.class.app');
    expect(await screen.findByText(/can’t be a Java keyword/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(puts()).toHaveLength(0);
    expect(screen.getByText('Fix the highlighted fields to save')).toBeInTheDocument();
  });
});

describe('AC10: a site must be reachable and use HTTPS', () => {
  const tryUrl = async (url: string) => {
    const user = userEvent.setup();
    open('basics');
    await user.type(await screen.findByRole('textbox', { name: 'Website address' }), url);
    await user.click(screen.getByRole('button', { name: 'Check website' }));
  };

  it('stops an HTTP-only site and says why', async () => {
    urlCheck = { reachable: true, https: false, mobileReady: true, embeddable: true };
    await tryUrl('http://plain.example');
    expect(await screen.findByText(/Doesn’t use HTTPS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^2\s?Branding$/ })).toBeDisabled();
    expect(puts()).toHaveLength(0);
  });

  it('stops a site on the unsafe list and says why', async () => {
    urlCheck = { reachable: false, failure: 'unsafe' };
    await tryUrl('https://testsafebrowsing.appspot.com/s/phishing.html');
    expect(await screen.findByText(/list of unsafe sites/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('stops an unreachable site and says why', async () => {
    urlCheck = { reachable: false, failure: 'unreachable' };
    await tryUrl('down.example');
    expect(await screen.findByText(/couldn’t reach that site/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('lets a good site through, suggests a package name and offers the site’s name', async () => {
    await tryUrl('shop.example.com');
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Package name' })).toHaveValue('com.example.shop.app');
    expect(await screen.findByText('Example Shop')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'App name' })).toHaveValue('');
    expect(calls.find((call) => call.path === '/url/check')?.body).toEqual({ url: 'https://shop.example.com' });
  });
});

describe('AC15: phone preview', () => {
  it('shows an embeddable site live', () => {
    render(<PhonePreview appName="Shop" startUrl="https://shop.example/" embeddable colour="#0E7C66" />);
    const frame = screen.getByTitle('Live preview of Shop');
    expect(frame).toHaveAttribute('src', 'https://shop.example/');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('explains a site that blocks embedding, with no blank frame', () => {
    render(<PhonePreview appName="Shop" startUrl="https://shop.example/" embeddable={false} />);
    expect(screen.queryByTitle(/Live preview/)).toBeNull();
    expect(screen.getByText(/doesn’t allow itself to be shown/)).toBeInTheDocument();
    expect(screen.getByText(/real app isn’t affected/)).toBeInTheDocument();
  });
});

describe('F10 AC9: a taken-down app', () => {
  it('tells the owner why, and offers no build', async () => {
    stored.draft = { startUrl: 'https://example.com/', appName: 'Example', packageName: 'com.example.app', ui: { statusBarColor: '#0F172A' } };
    stored.hasIcon = true;
    stored.ready = true;
    stored.takenDown = { reason: 'Phishing a bank login', at: '2026-11-07T10:00:00Z' };
    open('review');
    expect(await screen.findByText(/taken down: Phishing a bank login/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build app' })).toBeNull();
  });
});
