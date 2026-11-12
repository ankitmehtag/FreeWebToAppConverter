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
  /** Present when the app has push notifications turned on. */
  firebase: z
    .object({ apiKey: z.string(), appId: z.string(), projectId: z.string(), senderId: z.string(), topic: z.string() })
    .optional(),
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
  const { config, iconPath, plan, versionCode, versionName, parentDir, firebase } = renderInputSchema.parse(input);
  const icon = await readIcon(iconPath);

  const dir = await mkdtemp(join(parentDir ?? tmpdir(), 'sitetoapk-render-'));
  try {
    const color = config.ui.statusBarColor;
    const { background } = await generateIcons(icon, dir, color);

    await mkdir(join(dir, 'assets'));
    await mkdir(join(dir, 'res', 'values'));
    await writeFile(join(dir, 'assets', 'app_config.json'), JSON.stringify(config, null, 2));
    if (firebase) await writeFile(join(dir, 'assets', 'firebase.json'), JSON.stringify(firebase));
    await writeFile(join(dir, 'res', 'values', 'generated.xml'), generatedXml(config.appName, config.ui.splashColor ?? color, background));
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
  if (config.ads) {
    // Defence in depth: the ID shapes were checked by the schema above, so nothing else can reach Gradle here.
    if (plan !== 'premium') throw new Error('Ads are a Premium feature');
    gradleArgs.push('-PadsEnabled=true', `-PadsAppId=${config.ads.appId}`);
  }

  return { dir, gradleArgs };
};
