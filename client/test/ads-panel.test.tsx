import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Draft } from '@sitetoapk/shared';
import { AdsPanel } from '../src/ads-panel';

afterEach(cleanup);

const Harness = ({ premium, start, errors = {} }: { premium: boolean; start?: Draft['ads']; errors?: Record<string, string> }) => {
  const [ads, setAds] = useState<Draft['ads']>(start);
  return <AdsPanel premium={premium} ads={ads} errors={errors} onChange={setAds} onUpgrade={() => undefined} />;
};

describe('F16: the Monetization step', () => {
  it('is locked on Free, with a way to see Premium', async () => {
    const onUpgrade = vi.fn();
    render(<AdsPanel premium={false} ads={undefined} errors={{}} onChange={() => undefined} onUpgrade={onUpgrade} />);
    expect(screen.getByText(/Ads are a Premium feature/)).toBeTruthy();
    expect(screen.queryByLabelText('AdMob app ID')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See Premium' }));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it('shows the fields once ads are turned on, and the consent and Play notes', async () => {
    render(<Harness premium />);
    expect(screen.queryByLabelText('AdMob app ID')).toBeNull();
    await userEvent.click(screen.getByLabelText(/Show ads in this app/));
    expect(screen.getByLabelText('AdMob app ID')).toBeTruthy();
    expect(screen.getByLabelText('Banner ad unit ID')).toBeTruthy();
    expect(screen.getByLabelText('Interstitial ad unit ID')).toBeTruthy();
    expect(screen.getByText(/consent form before any ad/)).toBeTruthy();
    expect(screen.getByText(/declare that the app contains ads/)).toBeTruthy();
  });

  it('AC4: warns plainly when Google test IDs are used', () => {
    render(<Harness premium start={{ enabled: true, appId: 'ca-app-pub-3940256099942544~3347511713', bannerUnitId: 'ca-app-pub-3940256099942544/9214589741' }} />);
    expect(screen.getByText(/test ads and earns nothing/)).toBeTruthy();
  });

  it('does not warn about test IDs for real ones', () => {
    render(<Harness premium start={{ enabled: true, appId: 'ca-app-pub-1234567890123456~1234567890', bannerUnitId: 'ca-app-pub-1234567890123456/1111111111' }} />);
    expect(screen.queryByText(/test ads and earns nothing/)).toBeNull();
  });

  it('shows a problem next to its field', () => {
    render(<Harness premium start={{ enabled: true, appId: 'x' }} errors={{ 'ads.appId': 'Use the app ID from AdMob.' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Use the app ID from AdMob.');
  });

  it('keeps the minimum gap on the input', async () => {
    render(<Harness premium start={{ enabled: true }} />);
    const gap = screen.getByLabelText('Seconds between full-screen ads') as HTMLInputElement;
    expect(gap.min).toBe('60');
    expect(gap.value).toBe('180');
  });
});
