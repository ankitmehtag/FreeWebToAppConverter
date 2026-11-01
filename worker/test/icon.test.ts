import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { generateIcons, MAX_ICON_BYTES, readIcon } from '../src/icon';
import { png, tempFile } from './helpers';

// A valid header that claims a huge image, with only a little data behind it.
const bomb = () => {
  const png512 = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png512);
  png512.writeUInt32BE(13, 8);
  png512.write('IHDR', 12, 'latin1');
  png512.writeUInt32BE(30000, 16);
  png512.writeUInt32BE(30000, 20);
  png512[24] = 8;
  png512[25] = 6;
  return Buffer.concat([png512, deflateSync(Buffer.alloc(1000))]);
};

describe('AC7: rejected icons', () => {
  it('rejects a renamed JPEG', async () => {
    const jpeg = await sharp(await png(512)).jpeg().toBuffer();
    await expect(readIcon(tempFile('a.png', jpeg))).rejects.toThrow('not a PNG');
  });

  it('rejects HTML named .png', async () => {
    await expect(readIcon(tempFile('a.png', '<html><script>1</script></html>'))).rejects.toThrow('not a PNG');
  });

  it('rejects a truncated PNG', async () => {
    const whole = await sharp({
      create: { width: 512, height: 512, channels: 3, background: 'red' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await expect(readIcon(tempFile('a.png', whole.subarray(0, whole.length / 2)))).rejects.toThrow(
      'could not be read',
    );
  });

  it('rejects an undersized PNG', async () => {
    await expect(readIcon(tempFile('a.png', await png(511)))).rejects.toThrow('at least 512');
  });

  it('rejects a non-square PNG', async () => {
    await expect(readIcon(tempFile('a.png', await png(800, 600)))).rejects.toThrow('square');
  });

  it('rejects a file over the size limit', async () => {
    const big = Buffer.concat([await png(512), randomBytes(MAX_ICON_BYTES)]);
    await expect(readIcon(tempFile('a.png', big))).rejects.toThrow('5 MB');
  });

  it('rejects a bomb from its header', async () => {
    await expect(readIcon(tempFile('a.png', bomb()))).rejects.toThrow('at most 4096');
  });
});

describe('AC8: re-encoding', () => {
  it('drops metadata and trailing data', async () => {
    const tagged = await sharp(await png(512))
      .withExif({ IFD0: { Copyright: 'SECRET_EXIF' } })
      .png()
      .toBuffer();
    const file = tempFile('a.png', Buffer.concat([tagged, Buffer.from('SECRET_TRAILER')]));
    const icon = await readIcon(file);
    expect(icon.data.includes('SECRET_EXIF')).toBe(false);
    expect(icon.data.includes('SECRET_TRAILER')).toBe(false);
  });
});

describe('R9, R10: generated icons', () => {
  const generate = async (alpha: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'f03-icons-'));
    const result = await generateIcons(await readIcon(tempFile('a.png', await png(512, 512, alpha))), dir, '#0F172A');
    return { dir, ...result };
  };
  const size = async (path: string) => (await sharp(path).metadata()).width;

  it('writes every density', async () => {
    const { dir } = await generate(1);
    const expected = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
    for (const [density, [launcher, layer]] of Object.entries(expected)) {
      expect(await size(join(dir, `res/mipmap-${density}/ic_launcher.png`))).toBe(launcher);
      expect(await size(join(dir, `res/mipmap-${density}/ic_launcher_foreground.png`))).toBe(layer);
      expect(await size(join(dir, `res/mipmap-${density}/ic_launcher_monochrome.png`))).toBe(layer);
    }
    expect(await size(join(dir, 'play-store-icon.png'))).toBe(512);
  });

  it('declares an adaptive icon with a themed layer', async () => {
    const { dir } = await generate(1);
    const xml = readFileSync(join(dir, 'res/mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    expect(xml).toContain('@color/icon_background');
    expect(xml).toContain('@mipmap/ic_launcher_foreground');
    expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"');
  });

  it('keeps the artwork inside the safe zone', async () => {
    const { dir } = await generate(1);
    const layer = join(dir, 'res/mipmap-xxxhdpi/ic_launcher_foreground.png');
    const { channels } = await sharp(layer).stats();
    expect(channels[3]?.min).toBe(0);
    const pixel = async (x: number, y: number) =>
      (await sharp(layer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())[3];
    expect(await pixel(216, 216)).toBe(255);
    expect(await pixel(216, 60)).toBe(0);
  });

  it('keeps square corners inside the 66dp circle', async () => {
    const { dir } = await generate(1);
    const layer = join(dir, 'res/mipmap-xxxhdpi/ic_launcher_foreground.png');
    const { data, info } = await sharp(layer).raw().toBuffer({ resolveWithObject: true });
    const centre = info.width / 2;
    const radius = (33 * 4) ** 2;
    let furthest = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] === 0) continue;
        furthest = Math.max(furthest, (x + 0.5 - centre) ** 2 + (y + 0.5 - centre) ** 2);
      }
    }
    expect(furthest).toBeLessThanOrEqual(radius);
  });

  it('uses white behind an opaque logo', async () => {
    expect((await generate(1)).background).toBe('#FFFFFF');
  });

  it('uses the app colour behind a transparent logo', async () => {
    expect((await generate(0.5)).background).toBe('#0F172A');
  });

  it('keeps file sizes sensible', async () => {
    const { dir } = await generate(1);
    expect(statSync(join(dir, 'res/mipmap-mdpi/ic_launcher.png')).size).toBeGreaterThan(0);
  });
});
