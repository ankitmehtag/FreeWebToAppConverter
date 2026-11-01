import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AppConfig } from '@sitetoapk/shared';

export const config: AppConfig = {
  schemaVersion: 1,
  startUrl: 'https://example.com/',
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

export const tempFile = (name: string, data: Buffer | string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'f03-test-')), name);
  writeFileSync(path, data);
  return path;
};

export const png = (width: number, height = width, alpha = 1) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha } },
  })
    .png()
    .toBuffer();

export const iconFile = async (alpha = 1) => tempFile('icon.png', await png(512, 512, alpha));
