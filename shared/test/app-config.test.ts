import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appConfigJsonSchema, appConfigSchema } from '../src/app-config';

const valid = {
  schemaVersion: 1,
  startUrl: 'https://example.com/home',
  packageName: 'com.sitetoapk.example',
  appName: 'Example',
  internalHosts: ['example.com'],
  ui: {
    statusBarColor: '#0F172A',
    orientation: 'unspecified',
    zoom: false,
    progressBar: true,
    pullToRefresh: true,
    exitDialog: true,
  },
};

const accepts = (config: unknown) => appConfigSchema.safeParse(config).success;

describe('AC10: JSON schema', () => {
  it('committed file matches the generated output', () => {
    const committed = readFileSync(new URL('../app-config.schema.json', import.meta.url), 'utf8');
    expect(JSON.parse(committed)).toEqual(appConfigJsonSchema);
  });
});

describe('AC11: schemaVersion', () => {
  it('rejects a missing version', () => {
    const { schemaVersion, ...config } = valid;
    expect(accepts(config)).toBe(false);
  });

  it.each([0, 2, '1'])('rejects version %j', (schemaVersion) => {
    expect(accepts({ ...valid, schemaVersion })).toBe(false);
  });
});

describe('AC12: startUrl', () => {
  it.each([
    'not a url',
    'https://',
    'http://example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com',
  ])('rejects %s', (startUrl) => {
    expect(accepts({ ...valid, startUrl })).toBe(false);
  });

  it('rejects a missing URL', () => {
    const { startUrl, ...config } = valid;
    expect(accepts(config)).toBe(false);
  });
});

describe('AC13: packageName', () => {
  it.each([
    'example',
    'com.1example',
    'com._example',
    'com.class.example',
    'com.my-app',
    'com..example',
    '.com.example',
    'com.example.',
  ])('rejects %s', (packageName) => {
    expect(accepts({ ...valid, packageName })).toBe(false);
  });
});

describe('F02 AC1: Android settings', () => {
  it('accepts the sample config used by the Android template', () => {
    const path = '../../android-template/app/src/main/assets/app_config.json';
    const sample = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    expect(accepts(sample)).toBe(true);
  });

  it.each([[[]], [['https://example.com']], [['exa mple.com']], [['example.com/path']], ['example.com']])(
    'rejects internalHosts %j',
    (internalHosts) => {
      expect(accepts({ ...valid, internalHosts })).toBe(false);
    },
  );

  it.each(['red', '#FFF', '#GGGGGG', '0F172A'])('rejects statusBarColor %s', (statusBarColor) => {
    expect(accepts({ ...valid, ui: { ...valid.ui, statusBarColor } })).toBe(false);
  });

  it('rejects an unknown orientation', () => {
    expect(accepts({ ...valid, ui: { ...valid.ui, orientation: 'sideways' } })).toBe(false);
  });

  it.each(['zoom', 'progressBar', 'pullToRefresh', 'exitDialog'] as const)('requires a boolean %s', (toggle) => {
    expect(accepts({ ...valid, ui: { ...valid.ui, [toggle]: 'yes' } })).toBe(false);
  });

  it('rejects config that tries to set the plan', () => {
    expect(accepts({ ...valid, plan: 'premium' })).toBe(false);
  });
});

describe('AC14: valid config', () => {
  it('accepts a valid sample', () => {
    expect(accepts(valid)).toBe(true);
  });

  it('accepts underscores and digits after the first letter', () => {
    expect(accepts({ ...valid, packageName: 'com.site_to2.app' })).toBe(true);
  });
});
