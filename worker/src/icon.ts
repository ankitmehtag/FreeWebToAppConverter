import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkIcon, IconError, MAX_ICON_BYTES, type Icon } from '@sitetoapk/shared/icon';

export { MAX_ICON_BYTES, type Icon } from '@sitetoapk/shared/icon';

const LAUNCHER_DP = 48;
const LAYER_DP = 108;
const SAFE_ZONE_DP = 66;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** Validates an uploaded icon file and returns it re-encoded, without metadata or trailing data. */
export const readIcon = async (path: string): Promise<Icon> => {
  // Checked before reading, so that a huge file is never loaded.
  if ((await stat(path)).size > MAX_ICON_BYTES) throw new IconError('Icon must be 5 MB or smaller');
  return checkIcon(await readFile(path));
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
