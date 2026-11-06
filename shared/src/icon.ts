import sharp from 'sharp';

export const MAX_ICON_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 512;
const MAX_SIDE = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Icon = { data: Buffer; opaque: boolean };

/** A reason an icon was refused, safe to show to the user. */
export class IconError extends Error {}

/** Validates an icon and returns it re-encoded, without metadata or trailing data. */
export const checkIcon = async (file: Buffer): Promise<Icon> => {
  if (file.length > MAX_ICON_BYTES) throw new IconError('Icon must be 5 MB or smaller');
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE) || file.toString('latin1', 12, 16) !== 'IHDR') {
    throw new IconError('Icon is not a PNG');
  }

  // Read from the header, so that a bomb is rejected without being decoded.
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (width !== height) throw new IconError('Icon must be square');
  if (width < MIN_SIDE) throw new IconError(`Icon must be at least ${MIN_SIDE}×${MIN_SIDE}`);
  if (width > MAX_SIDE) throw new IconError(`Icon must be at most ${MAX_SIDE}×${MAX_SIDE}`);

  try {
    const image = sharp(file, { failOn: 'error', limitInputPixels: MAX_SIDE * MAX_SIDE });
    const data = await image.png().toBuffer();
    return { data, opaque: (await sharp(data).stats()).isOpaque };
  } catch {
    throw new IconError('Icon could not be read');
  }
};
