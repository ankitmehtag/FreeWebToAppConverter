import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { config, iconFile } from './helpers';

const input = async (changes = {}) => ({
  config,
  iconPath: await iconFile(),
  plan: 'free' as const,
  versionCode: 1,
  versionName: '1.0',
  ...changes,
});

const files = (dir: string) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();

describe('AC1: render', () => {
  it('writes the same files to two separate folders', async () => {
    const options = await input();
    const first = await render(options);
    const second = await render(options);
    expect(first.dir).not.toBe(second.dir);
    expect(files(first.dir)).toEqual(files(second.dir));
    for (const file of ['assets/app_config.json', 'res/values/generated.xml']) {
      expect(readFileSync(join(first.dir, file))).toEqual(readFileSync(join(second.dir, file)));
    }
  });
});

describe('AC2: invalid input', () => {
  const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith('sitetoapk-render-')).length;

  it.each([
    ['config', { config: { ...config, startUrl: 'http://example.com/' } }],
    ['version code', { versionCode: 0 }],
    ['version name', { versionName: '1.0; rm -rf /' }],
    ['plan', { plan: 'gold' }],
  ])('rejects a bad %s and leaves no folder', async (_, changes) => {
    const before = leftovers();
    await expect(render(await input(changes))).rejects.toThrow();
    expect(leftovers()).toBe(before);
  });

  it('leaves no folder when the icon is rejected', async () => {
    const before = leftovers();
    await expect(render(await input({ iconPath: '/nonexistent.png' }))).rejects.toThrow();
    expect(leftovers()).toBe(before);
  });
});

describe('AC4: app_config.json', () => {
  it('round-trips hostile values and adds no field', async () => {
    const hostile = {
      ...config,
      appName: '"}, "extra": "</script>\\',
      startUrl: 'https://example.com/?a="b"&c=\\d',
    };
    const { dir } = await render(await input({ config: hostile }));
    const written = JSON.parse(readFileSync(join(dir, 'assets/app_config.json'), 'utf8'));
    expect(written).toEqual(hostile);
  });
});

describe('AC5: user values stay out of code', () => {
  it('writes no Gradle or Kotlin file', async () => {
    const { dir } = await render(await input());
    expect(files(dir).filter((file) => /\.(gradle|kts|kt|sh)$/.test(file))).toEqual([]);
  });

  it('keeps the name out of the Gradle arguments', async () => {
    const hostile = { ...config, appName: 'MARKER_NAME' };
    const { gradleArgs } = await render(await input({ config: hostile }));
    expect(gradleArgs.join(' ')).not.toContain('MARKER_NAME');
  });
});

describe('Gradle arguments', () => {
  it('passes the fixed properties as one argument each', async () => {
    const { dir, gradleArgs } = await render(await input({ versionCode: 7, versionName: '2.3.1' }));
    expect(gradleArgs).toEqual([
      '-PapplicationId=com.sitetoapk.example',
      '-PversionCode=7',
      '-PversionName=2.3.1',
      `-PgeneratedDir=${dir}`,
    ]);
  });

  it('removes the watermark only on Premium', async () => {
    const premium = await render(await input({ plan: 'premium' }));
    expect(premium.gradleArgs).toContain('-PremoveWatermark=true');
  });
});

describe('R6: colours', () => {
  it('writes the splash colour from statusBarColor', async () => {
    const hostile = { ...config, ui: { ...config.ui, statusBarColor: '#B91C1C' } };
    const { dir } = await render(await input({ config: hostile }));
    expect(readFileSync(join(dir, 'res/values/generated.xml'), 'utf8')).toContain(
      '<color name="splash_background">#B91C1C</color>',
    );
  });

  it('uses splashColor for the splash when it is set', async () => {
    const custom = { ...config, ui: { ...config.ui, statusBarColor: '#B91C1C', splashColor: '#112233' } };
    const { dir } = await render(await input({ config: custom }));
    expect(readFileSync(join(dir, 'res/values/generated.xml'), 'utf8')).toContain(
      '<color name="splash_background">#112233</color>',
    );
  });

  it('never creates a file named from user input', async () => {
    const { dir } = await render(await input());
    expect(existsSync(join(dir, 'com.sitetoapk.example'))).toBe(false);
  });
});
