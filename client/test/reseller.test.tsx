import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api';
import { InstallPage } from '../src/pages/install';
import { ResellerDashboard } from '../src/pages/reseller';

vi.mock('../src/api', async (original) => ({ ...(await original<typeof import('../src/api')>()), api: vi.fn() }));
vi.mock('../src/session', () => ({ useSession: () => ({ me: { email: 'a@b.co' }, signOut: async () => undefined }) }));

const brand = { slug: 'pixel', brandName: 'Pixel Agency', logoUrl: null, accent: '#ff5500', showBuiltWith: true };
const me = { brand, plan: { name: 'Growth' }, quota: { limit: 30, used: 12, remaining: 18 }, apiEnabled: true, lapsed: false, payment: { available: false, priceMinor: 249900, paidUntil: null as string | null } };
const app = { id: 'a1', draft: { appName: 'Client Shop', startUrl: 'https://shop.example.com/' }, ready: true, hasIcon: false, updatedAt: '2026-11-16', latestBuild: undefined };

const answer = (routes: Record<string, unknown>) =>
  vi.mocked(api).mockImplementation((async (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected ${String(path)}`);
    const value = routes[path];
    if (value instanceof Error) throw value;
    return value;
  }) as never);

const dashboard = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/r/${slug}`]}>
      <Routes><Route path="r/:slug" element={<ResellerDashboard />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(api).mockReset();
});
afterEach(cleanup);

describe('F20 AC4: the reseller dashboard', () => {
  it('shows the reseller\'s brand, remaining builds and client apps, with their accent', async () => {
    answer({ '/resellers/me': me, '/apps': [app] });
    const { container } = dashboard('pixel');
    expect(await screen.findByText('Pixel Agency')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText(/of 30 builds left this month · Growth plan/)).toBeTruthy();
    expect(screen.getByText('Client Shop')).toBeTruthy();
    expect(screen.getByText('Built with Free Website to App Converter')).toBeTruthy();
    expect(container.querySelector<HTMLElement>('.reseller')!.style.getPropertyValue('--teal')).toBe('#ff5500');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
  });

  it('drops the built-with line when the plan removes it', async () => {
    answer({ '/resellers/me': { ...me, brand: { ...brand, showBuiltWith: false } }, '/apps': [] });
    dashboard('pixel');
    await screen.findByText('Pixel Agency');
    expect(screen.queryByText(/Built with/)).toBeNull();
    expect(screen.getByText(/No client apps yet/)).toBeTruthy();
  });

  it('says so, and pauses new apps, when the plan has lapsed', async () => {
    answer({ '/resellers/me': { ...me, lapsed: true }, '/apps': [] });
    dashboard('pixel');
    expect(await screen.findByText(/plan has lapsed/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New app' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is "not found" for anyone who is not this slug\'s reseller', async () => {
    answer({ '/resellers/me': me, '/apps': [] });
    dashboard('someone-else');
    expect(await screen.findByText('Page not found')).toBeTruthy();
    answer({ '/resellers/me': new Error('404'), '/apps': [] });
    cleanup();
    dashboard('pixel');
    await waitFor(() => expect(screen.getByText('Page not found')).toBeTruthy());
  });
});

describe('F20 AC2: paying for a month', () => {
  const modal = { open: vi.fn(), on: vi.fn() };
  let options: Record<string, unknown> = {};
  beforeEach(() => {
    modal.open.mockReset();
    modal.on.mockReset();
    (window as unknown as { Razorpay: unknown }).Razorpay = function (given: Record<string, unknown>) { options = given; return modal; };
  });
  afterEach(() => {
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  });
  const checkout = { id: 'o1', checkout: { keyId: 'rzp_test_x', orderId: 'order_1', amount: 249900, currency: 'INR', checkoutUrl: null } };

  it('shows no pay button when payments are off, and the end of the paid month when there is one', async () => {
    answer({ '/resellers/me': { ...me, payment: { available: false, priceMinor: 249900, paidUntil: '2026-12-16T00:00:00Z' } }, '/apps': [] });
    dashboard('pixel');
    await screen.findByText('Pixel Agency');
    expect(screen.queryByRole('button', { name: /Pay / })).toBeNull();
    expect(screen.getByText(/Paid until/)).toBeTruthy();
  });

  it('opens the payment window at the plan price and refreshes after the server verifies it', async () => {
    const calls: string[] = [];
    vi.mocked(api).mockImplementation((async (path: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/resellers/me') return { ...me, payment: { available: true, priceMinor: 249900, paidUntil: null } };
      if (path === '/apps') return [];
      if (path === '/resellers/me/pay') return checkout;
      if (path === '/resellers/me/pay/verify') return { paid: true };
      throw new Error(`unexpected ${path}`);
    }) as never);
    dashboard('pixel');
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹2499 for a month' }));
    await waitFor(() => expect(modal.open).toHaveBeenCalled());
    expect(options).toMatchObject({ key: 'rzp_test_x', order_id: 'order_1', amount: 249900, currency: 'INR', description: 'Growth plan, one month' });
    (options.handler as (r: object) => void)({ razorpay_payment_id: 'p', razorpay_order_id: 'order_1', razorpay_signature: 's' });
    await waitFor(() => expect(calls.filter((c) => c === 'GET /resellers/me').length).toBe(2));
    expect(calls).toContain('POST /resellers/me/pay/verify');
  });

  it('shows the server\'s refusal, and a cancelled window is not an error', async () => {
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === '/resellers/me') return { ...me, payment: { available: true, priceMinor: 249900, paidUntil: null } };
      if (path === '/apps') return [];
      throw new ApiError(502, 'The payment provider is not answering, try again soon');
    }) as never);
    dashboard('pixel');
    await userEvent.click(await screen.findByRole('button', { name: /Pay / }));
    expect(await screen.findByText(/not answering/)).toBeTruthy();
  });
});

describe('F20 AC4: the branded download page', () => {
  const install = () =>
    render(
      <MemoryRouter initialEntries={['/install/tok']}>
        <Routes><Route path="install/:token" element={<InstallPage />} /></Routes>
      </MemoryRouter>,
    );
  const info = { appName: 'Client Shop', versionName: '1.0', versionCode: 1, artifactBytes: 5_000_000 };

  it('wears the reseller\'s brand, and ours is only a small line', async () => {
    answer({ '/builds/install/tok': { ...info, brand } });
    const { container } = install();
    expect(await screen.findByText('Pixel Agency')).toBeTruthy();
    expect(screen.getByText('Built with Free Website to App Converter')).toBeTruthy();
    expect(container.querySelector<HTMLElement>('main')!.style.getPropertyValue('--teal')).toBe('#ff5500');
  });

  it('is unchanged for an ordinary build', async () => {
    answer({ '/builds/install/tok': info });
    const { container } = install();
    expect(await screen.findByText('Client Shop')).toBeTruthy();
    expect(screen.queryByText(/Built with/)).toBeNull();
    expect(container.querySelector<HTMLElement>('main')!.style.getPropertyValue('--teal')).toBe('');
  });
});
