import { describe, expect, it } from 'vitest';
import { ADS_TEST_PUBLISHER, adsConfigSchema, appConfigSchema, isTestAdsId, permissionsFor, toAppConfig, AD_ID, INTERNET, type Draft } from '../src';

const ids = { appId: 'ca-app-pub-1234567890123456~1234567890', bannerUnitId: 'ca-app-pub-1234567890123456/1111111111', interstitialUnitId: 'ca-app-pub-1234567890123456/2222222222' };
const draft = (ads?: Draft['ads']): Draft => ({ startUrl: 'https://example.com', appName: 'Shop', packageName: 'com.example.shop', ui: { statusBarColor: '#112233' }, ...(ads ? { ads } : {}) });
const on = { enabled: true, ...ids };

describe('AC3: ID shapes', () => {
  const ok = { ...ids, bannerPosition: 'bottom', interstitialGapSeconds: 180, childDirected: false } as const;
  it('accepts valid IDs', () => expect(adsConfigSchema.safeParse(ok).success).toBe(true));
  it('refuses malformed IDs', () => {
    expect(adsConfigSchema.safeParse({ ...ok, appId: 'ca-app-pub-123~456' }).success).toBe(false);
    expect(adsConfigSchema.safeParse({ ...ok, bannerUnitId: 'ca-app-pub-1234567890123456~1111111111' }).success).toBe(false);
    expect(adsConfigSchema.safeParse({ ...ok, interstitialUnitId: 'nope' }).success).toBe(false);
  });
  it('refuses a unit from another publisher and names the field', () => {
    const result = adsConfigSchema.safeParse({ ...ok, interstitialUnitId: 'ca-app-pub-9999999999999999/2222222222' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['interstitialUnitId']);
  });
  it('needs at least one unit', () => {
    const result = adsConfigSchema.safeParse({ ...ok, bannerUnitId: undefined, interstitialUnitId: undefined });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['bannerUnitId']);
  });
  it('keeps the gap between interstitials at a minute or more', () => {
    expect(adsConfigSchema.safeParse({ ...ok, interstitialGapSeconds: 59 }).success).toBe(false);
    expect(adsConfigSchema.safeParse({ ...ok, interstitialGapSeconds: 60 }).success).toBe(true);
  });
});

describe('AC2: the draft keeps ad settings and renders them', () => {
  it('leaves no trace when ads are off', () => {
    expect(toAppConfig(draft())?.ads).toBeUndefined();
    expect(toAppConfig(draft({ enabled: false, ...ids }))?.ads).toBeUndefined();
    expect('ads' in (toAppConfig(draft({ enabled: false }))!)).toBe(false);
  });
  it('renders defaults when ads are on', () => {
    expect(toAppConfig(draft(on))?.ads).toEqual({ ...ids, bannerPosition: 'bottom', interstitialGapSeconds: 180, childDirected: false });
  });
  it('is not ready while ads are on but incomplete', () => {
    expect(toAppConfig(draft({ enabled: true }))).toBeNull();
    expect(toAppConfig(draft({ enabled: true, appId: ids.appId }))).toBeNull();
  });
  it('the config schema takes the rendered result', () => {
    expect(appConfigSchema.safeParse(toAppConfig(draft(on))).success).toBe(true);
  });
});

describe('AC4: test IDs', () => {
  it('spots Google sample IDs', () => {
    expect(isTestAdsId(`ca-app-pub-${ADS_TEST_PUBLISHER}~3347511713`)).toBe(true);
    expect(isTestAdsId(`ca-app-pub-${ADS_TEST_PUBLISHER}/6300978111`)).toBe(true);
    expect(isTestAdsId(ids.appId)).toBe(false);
    expect(isTestAdsId(undefined)).toBe(false);
  });
});

describe('R8: permissions', () => {
  it('adds the advertising ID only when ads are on', () => {
    expect(permissionsFor(toAppConfig(draft())!)).toEqual([INTERNET]);
    expect(permissionsFor(toAppConfig(draft(on))!)).toEqual([INTERNET, AD_ID]);
  });
});
