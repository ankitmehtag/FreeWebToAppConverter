import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkIcon, IconError, MAX_ICON_BYTES } from '../src/icon';

const png = (width: number, height = width) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();

describe('AC12: icon checks', () => {
  it.each([
    ['a renamed JPEG', async () => sharp(await png(512)).jpeg().toBuffer(), 'not a PNG'],
    ['a 256×256 PNG', () => png(256), 'at least 512'],
    ['a non-square PNG', () => png(800, 600), 'square'],
    ['a 6 MB file', async () => Buffer.concat([await png(512), randomBytes(MAX_ICON_BYTES + 1024 * 1024 - 100_000)]), '5 MB'],
  ])('refuses %s with its reason', async (_name, make, reason) => {
    const check = checkIcon(await make());
    await expect(check).rejects.toBeInstanceOf(IconError);
    await expect(check).rejects.toThrow(reason);
  });

  it('accepts a 512×512 PNG and drops trailing data', async () => {
    const icon = await png(512);
    const result = await checkIcon(Buffer.concat([icon, Buffer.from('<?php echo 1; ?>')]));
    expect((await sharp(result.data).metadata()).width).toBe(512);
    expect(result.data.includes('<?php')).toBe(false);
    expect(result.opaque).toBe(true);
  });
});
