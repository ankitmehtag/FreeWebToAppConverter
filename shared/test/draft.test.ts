import { describe, expect, it } from 'vitest';
import { appConfigSchema } from '../src/app-config';
import { draftSchema, INTERNET, permissionsFor, suggestPackageName, toAppConfig } from '../src/draft';

const accepts = (draft: unknown) => draftSchema.safeParse(draft).success;

const complete = {
  startUrl: 'https://example.com/',
  appName: 'Example',
  packageName: 'com.example.app',
  ui: { statusBarColor: '#0F172A' },
};

describe('AC9: draft rules', () => {
  it('accepts an empty draft and a partial one', () => {
    expect(accepts({})).toBe(true);
    expect(accepts({ startUrl: 'https://example.com/' })).toBe(true);
    expect(accepts({ ui: { zoom: true } })).toBe(true);
  });

  it.each([
    ['an HTTP URL', { startUrl: 'http://example.com/' }],
    ['an app name with a control character', { appName: 'Bad\u0007name' }],
    ['an empty app name', { appName: '   ' }],
    ['a package name with one segment', { packageName: 'example' }],
    ['a package name with a Java reserved word', { packageName: 'com.class.app' }],
    ['a package name starting with a digit', { packageName: 'com.1example.app' }],
    ['a bad colour', { ui: { statusBarColor: 'red' } }],
    ['a bad orientation', { ui: { orientation: 'sideways' } }],
    ['an extra field', { plan: 'premium' }],
    ['an extra ui field', { ui: { watermark: false } }],
  ])('refuses %s', (_name, draft) => {
    expect(accepts(draft)).toBe(false);
  });

  it('keeps a hostile app name as text', () => {
    expect(accepts({ appName: '"; rm -rf / <b>&amp;</b>' })).toBe(true);
  });
});

describe('rendering a draft', () => {
  it('needs every required field', () => {
    expect(toAppConfig({ startUrl: 'https://example.com/' })).toBeNull();
    const { ui, ...noColour } = complete;
    expect(toAppConfig(noColour)).toBeNull();
  });

  it('renders a config the shared schema accepts, with defaults for untouched behaviour', () => {
    const config = toAppConfig(complete);
    expect(appConfigSchema.safeParse(config).success).toBe(true);
    expect(config).toMatchObject({ internalHosts: ['example.com'], ui: { orientation: 'unspecified', progressBar: true } });
  });

  it('keeps behaviour the user changed', () => {
    const config = toAppConfig({ ...complete, internalHosts: ['shop.example.com'], ui: { statusBarColor: '#000000', zoom: true } });
    expect(config).toMatchObject({ internalHosts: ['shop.example.com'], ui: { zoom: true } });
  });
});

describe('package name suggestion', () => {
  it.each([
    ['example.com', 'com.example.app'],
    ['www.example.com', 'com.example.app'],
    ['my-site.co.uk', 'uk.co.my_site.app'],
    ['123shop.in', 'in.x123shop.app'],
    ['class.example.com', 'com.example.class_.app'],
    ['Shop.Example.COM', 'com.example.shop.app'],
  ])('suggests a valid name for %s', (host, expected) => {
    expect(suggestPackageName(host)).toBe(expected);
    expect(accepts({ packageName: expected })).toBe(true);
  });
});

describe('permissions', () => {
  it('asks for the internet only with today’s template', () => {
    expect(permissionsFor(toAppConfig(complete)!)).toEqual([INTERNET]);
  });
});
