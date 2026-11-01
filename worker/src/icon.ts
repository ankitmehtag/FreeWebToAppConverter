import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const MAX_ICON_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 512;
const MAX_SIDE = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const LAUNCHER_DP = 48;
const LAYER_DP = 108;
const SAFE_ZONE_DP = 66;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

export type Icon = { data: Buffer; opaque: boolean };

/** Validates an uploaded icon and returns it re-encoded, without metadata or trailing data. */
export const readIcon = async (path: string): Promise<Icon> => {
  if ((await stat(path)).size > MAX_ICON_BYTES) throw new Error('Icon must be 5 MB or smaller');

  const file = await readFile(path);
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE) || file.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('Icon is not a PNG');
  }

  // Read from the header, so that a bomb is rejected without being decoded.
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (width !== height) throw new Error('Icon must be square');
  if (width < MIN_SIDE) throw new Error(`Icon must be at least ${MIN_SIDE}×${MIN_SIDE}`);
  if (width > MAX_SIDE) throw new Error(`Icon must be at most ${MAX_SIDE}×${MAX_SIDE}`);

  try {
    const image = sharp(file, { failOn: 'error', limitInputPixels: MAX_SIDE * MAX_SIDE });
    const data = await image.png().toBuffer();
    return { data, opaque: (await sharp(data).stats()).isOpaque };
  } catch {
    throw new Error('Icon could not be read');
  }
};

// The safe zone is a circle, so a square logo must fit inside it with its corners.
const paddedSize = (size: number) => {
  const art = Math.floor((size * SAFE_ZONE_DP) / LAYER_DP / Math.SQRT2);
  const before = Math.floor((size - art) / 2);
  return { art, before, after: size - art - before };
};

const foreground = async (icon: Icon, size: number) => {
  const { art, before, after } = paddedSize(size);
  return sharp(icon.data)
    .resize(art, art)
    .extend({ top: before, bottom: after, left: before, right: after, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
};

// Android tints this layer using only its alpha. A transparent logo already has
// that shape, and for an opaque one the dark parts become the shape.
const monochrome = async (icon: Icon, size: number) => {
  const { art, before, after } = paddedSize(size);
  const resized = sharp(icon.data).resize(art, art);
  const shape = icon.opaque ? resized.removeAlpha().greyscale().negate() : resized.extractChannel('alpha');
  const mask = await shape
    .extend({ top: before, bottom: after, left: before, right: after, background: { r: 0, g: 0, b: 0 } })
    .toColourspace('b-w')
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#FFFFFF' } })
    .joinChannel(mask)
    .png()
    .toBuffer();
};

const ADAPTIVE_ICON = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

/** Writes all icon files into [dir] and returns the adaptive icon background. */
export const generateIcons = async (icon: Icon, dir: string, appColor: string) => {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const folder = join(dir, 'res', `mipmap-${density}`);
    const layer = LAYER_DP * scale;
    const launcher = LAUNCHER_DP * scale;
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'ic_launcher.png'), await sharp(icon.data).resize(launcher, launcher).png().toBuffer());
    await writeFile(join(folder, 'ic_launcher_foreground.png'), await foreground(icon, layer));
    await writeFile(join(folder, 'ic_launcher_monochrome.png'), await monochrome(icon, layer));
  }

  const anydpi = join(dir, 'res', 'mipmap-anydpi-v26');
  await mkdir(anydpi, { recursive: true });
  await writeFile(join(anydpi, 'ic_launcher.xml'), ADAPTIVE_ICON);
  await writeFile(join(dir, 'play-store-icon.png'), await sharp(icon.data).resize(512, 512).png().toBuffer());

  return { background: icon.opaque ? '#FFFFFF' : appColor };
};
