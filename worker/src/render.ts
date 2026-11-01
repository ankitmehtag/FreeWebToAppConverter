import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appConfigSchema } from '@sitetoapk/shared';
import { z } from 'zod';
import { generateIcons, readIcon } from './icon';
import { androidString } from './xml';

const renderInputSchema = z.object({
  config: appConfigSchema,
  iconPath: z.string().min(1),
  plan: z.enum(['free', 'premium']),
  versionCode: z.number().int().min(1).max(2100000000),
  versionName: z.string().regex(/^\d+(\.\d+){0,3}$/),
  parentDir: z.string().optional(),
});

export type RenderInput = z.input<typeof renderInputSchema>;

const generatedXml = (appName: string, splash: string, iconBackground: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" formatted="false">${androidString(appName)}</string>
    <color name="splash_background">${splash}</color>
    <color name="icon_background">${iconBackground}</color>
</resources>
`;

/**
 * Writes everything a build needs into a new temp folder. User text reaches the
 * build only through the files written here, each escaped for its format.
 */
export const render = async (input: RenderInput) => {
  const { config, iconPath, plan, versionCode, versionName, parentDir } = renderInputSchema.parse(input);
  const icon = await readIcon(iconPath);

  const dir = await mkdtemp(join(parentDir ?? tmpdir(), 'sitetoapk-render-'));
  try {
    const color = config.ui.statusBarColor;
    const { background } = await generateIcons(icon, dir, color);

    await mkdir(join(dir, 'assets'));
    await mkdir(join(dir, 'res', 'values'));
    await writeFile(join(dir, 'assets', 'app_config.json'), JSON.stringify(config, null, 2));
    await writeFile(join(dir, 'res', 'values', 'generated.xml'), generatedXml(config.appName, color, background));
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  const gradleArgs = [
    `-PapplicationId=${config.packageName}`,
    `-PversionCode=${versionCode}`,
    `-PversionName=${versionName}`,
    `-PgeneratedDir=${dir}`,
  ];
  if (plan === 'premium') gradleArgs.push('-PremoveWatermark=true');

  return { dir, gradleArgs };
};
