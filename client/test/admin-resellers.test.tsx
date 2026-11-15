import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { Plans, Resellers } from '../src/pages/admin-resellers';

vi.mock('../src/api', async (original) => ({ ...(await original<typeof import('../src/api')>()), api: vi.fn() }));

const plan = { id: 'p1', name: 'Growth', priceMinor: 249900, buildsPerMonth: 30, api: true, builtWithLine: true, active: true };
const reseller = {
  id: 'r1', slug: 'pixel', brandName: 'Pixel Agency', logoUrl: '', accent: '#ff5500', callbackUrl: '', userEmail: 'owner@example.com', planId: 'p1', planName: 'Growth',
  quota: { limit: 30, used: 12, bonus: 0 }, paidUntil: '2026-12-16T00:00:00Z', suspended: false, lapsed: false,
};
const key = { id: 'k1', name: 'ci', prefix: 'rk_AbCd1', createdAt: '2026-11-16T10:00:00Z', lastUsedAt: null, revoked: false };

const posts = () => vi.mocked(api).mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === 'POST');

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((async (path: string) => {
    if (path === '/admin/api/plans') return { plans: [plan] };
    if (path === '/admin/api/resellers') return { resellers: [reseller] };
    if (path === '/admin/api/resellers/r1/keys') return { keys: [key] };
    return undefined;
  }) as never);
  vi.stubGlobal('prompt', vi.fn(() => 'because I said so'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('F20 admin: Plans tab', () => {
  it('lists the plans with price and build count', async () => {
    render(<Plans />);
    expect(await screen.findByText('Growth')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText("₹2499")).toBeTruthy();
  });

  it('creates a plan, typing rupees and sending paise with the reason', async () => {
    render(<Plans />);
    await screen.findByText('Growth');
    await userEvent.type(screen.getByLabelText('Plan name'), 'Studio');
    await userEvent.type(screen.getByLabelText('Price a month (₹)'), '1499.50');
    await userEvent.type(screen.getByLabelText('Builds a month'), '20');
    await userEvent.click(screen.getByLabelText('API included'));
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(posts()).toEqual([['/admin/api/plans', { method: 'POST', body: { name: 'Studio', priceMinor: 149950, buildsPerMonth: 20, api: true, builtWithLine: true, active: true, reason: 'because I said so' } }]]);
  });

  it('edits a plan and applies the build count to current subscribers only when ticked', async () => {
    render(<Plans />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Plan name') as HTMLInputElement).value).toBe('Growth');
    await userEvent.clear(screen.getByLabelText('Builds a month'));
    await userEvent.type(screen.getByLabelText('Builds a month'), '40');
    await userEvent.click(screen.getByLabelText(/Apply the build count to current subscribers now/));
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(posts()[0]).toEqual(['/admin/api/plans/p1', { method: 'POST', body: expect.objectContaining({ priceMinor: 249900, buildsPerMonth: 40, applyQuotaNow: true, reason: 'because I said so' }) }]);
  });

  it('sends nothing when the reason prompt is cancelled', async () => {
    vi.stubGlobal('prompt', vi.fn(() => null));
    render(<Plans />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(posts()).toEqual([]);
  });
});

describe('F20 admin: Resellers tab', () => {
  it('lists resellers with owner, plan and builds used', async () => {
    render(<Resellers />);
    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('12 of 30')).toBeTruthy();
    expect(screen.getByText('/r/pixel')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('creates a reseller on the first offered plan', async () => {
    render(<Resellers />);
    await screen.findByText('owner@example.com');
    await userEvent.type(screen.getByLabelText(/Owner's email/), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/Page name/), 'studio-one');
    await userEvent.type(screen.getByLabelText('Brand name'), 'Studio One');
    await userEvent.click(screen.getByRole('button', { name: 'Create reseller' }));
    expect(posts()[0]).toEqual(['/admin/api/resellers', { method: 'POST', body: { userEmail: 'new@example.com', slug: 'studio-one', brandName: 'Studio One', accent: '#2563eb', planId: 'p1', reason: 'because I said so' } }]);
  });

  it('sends only what changed, so the plan is not re-copied at today\'s price', async () => {
    render(<Resellers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Brand name'));
    await userEvent.type(screen.getByLabelText('Brand name'), 'Pixel Studio');
    await userEvent.type(screen.getByLabelText(/Add builds this month/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save reseller' }));
    expect(posts()[0]).toEqual(['/admin/api/resellers/r1', { method: 'POST', body: { brandName: 'Pixel Studio', addQuota: 5, reason: 'because I said so' } }]);
  });

  it('cancels a running plan and shows when the paid month ends', async () => {
    render(<Resellers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel plan' }));
    expect(posts()[0]![0]).toBe('/admin/api/resellers/r1/cancel-plan');
    expect(screen.getByText(new Date('2026-12-16T00:00:00Z').toLocaleDateString())).toBeTruthy();
  });

  it('offers to reinstate a lapsed plan instead', async () => {
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === '/admin/api/resellers') return { resellers: [{ ...reseller, lapsed: true, paidUntil: null }] };
      if (path === '/admin/api/plans') return { plans: [plan] };
      return undefined;
    }) as never);
    render(<Resellers />);
    expect(await screen.findByText('not paid by them')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reinstate plan' }));
    expect(posts()[0]![0]).toBe('/admin/api/resellers/r1/reinstate-plan');
    expect(screen.queryByRole('button', { name: 'Cancel plan' })).toBeNull();
  });

  it('suspends, and shows the keys with a revoke button', async () => {
    render(<Resellers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(posts()[0]![0]).toBe('/admin/api/resellers/r1/suspend');
    await userEvent.click(screen.getByRole('button', { name: 'Keys' }));
    const panel = (await screen.findByText('API keys')).closest('article')!;
    expect(within(panel).getByText('rk_AbCd1')).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Revoke' }));
    expect(posts().at(-1)![0]).toBe('/admin/api/resellers/r1/keys/k1/revoke');
  });

  it('never asks for or shows a key or secret', async () => {
    const { container } = render(<Resellers />);
    await screen.findByText('owner@example.com');
    expect(container.textContent).not.toMatch(/whsec_|secret/i);
  });
});
