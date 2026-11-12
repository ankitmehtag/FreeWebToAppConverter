import { z } from 'zod';

export const JAVA_RESERVED_WORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally',
  'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
  'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
  'true', 'try', 'void', 'volatile', 'while',
]);

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const ADS_APP_ID = /^ca-app-pub-(\d{16})~\d{10}$/;
const ADS_UNIT_ID = /^ca-app-pub-(\d{16})\/\d{10}$/;

/** Google's public sample IDs. They show test ads and earn nothing. */
export const ADS_TEST_PUBLISHER = '3940256099942544';
export const isTestAdsId = (id: string | undefined) => Boolean(id?.includes(`ca-app-pub-${ADS_TEST_PUBLISHER}`));

export const ADS_MIN_GAP_SECONDS = 60;
export const ADS_DEFAULT_GAP_SECONDS = 180;

const adsFields = {
  appId: z.string().regex(ADS_APP_ID, 'Must look like ca-app-pub-1234567890123456~1234567890'),
  bannerUnitId: z.string().regex(ADS_UNIT_ID, 'Must look like ca-app-pub-1234567890123456/1234567890').optional(),
  interstitialUnitId: z.string().regex(ADS_UNIT_ID, 'Must look like ca-app-pub-1234567890123456/1234567890').optional(),
  bannerPosition: z.enum(['top', 'bottom']),
  interstitialGapSeconds: z.number().int().min(ADS_MIN_GAP_SECONDS).max(3600),
  /** Marks the app as directed to children: child-directed and under-age treatment on every ad request. */
  childDirected: z.boolean(),
};

/** Where an ads setting is wrong, as a field name, or undefined when the whole set is fine. */
const adsProblem = (ads: { appId: string; bannerUnitId?: string; interstitialUnitId?: string }): string | undefined => {
  if (!ads.bannerUnitId && !ads.interstitialUnitId) return 'bannerUnitId';
  const publisher = ADS_APP_ID.exec(ads.appId)?.[1];
  for (const field of ['bannerUnitId', 'interstitialUnitId'] as const) {
    const unit = ads[field];
    if (unit && ADS_UNIT_ID.exec(unit)?.[1] !== publisher) return field;
  }
  return undefined;
};

/** Present only when ads are on. Premium only: the server and the worker both refuse it on Free. */
export const adsConfigSchema = z.strictObject(adsFields).superRefine((ads, ctx) => {
  const field = adsProblem(ads);
  if (field) ctx.addIssue({ code: 'custom', path: [field], message: field === 'bannerUnitId' && !ads.bannerUnitId && !ads.interstitialUnitId ? 'Add a banner or an interstitial unit' : 'Must belong to the same AdMob account as the app ID' });
});

export type AdsConfig = z.infer<typeof adsConfigSchema>;

/** The wizard's saved ad settings: every field optional, plus the switch. */
export const adsDraftSchema = z.strictObject({
  enabled: z.boolean(),
  appId: adsFields.appId.optional(),
  bannerUnitId: adsFields.bannerUnitId,
  interstitialUnitId: adsFields.interstitialUnitId,
  bannerPosition: adsFields.bannerPosition.optional(),
  interstitialGapSeconds: adsFields.interstitialGapSeconds.optional(),
  childDirected: adsFields.childDirected.optional(),
});

export const appConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  startUrl: z.string().regex(/^https:\/\/\S+$/).refine(isHttpsUrl, 'Must be a valid HTTPS URL'),
  packageName: z
    .string()
    .regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/)
    .refine(
      (value) => !value.split('.').some((segment) => JAVA_RESERVED_WORDS.has(segment)),
      'Must not contain a Java reserved word',
    ),
  appName: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[^\p{Cc}\p{Cs}]*$/u, 'Must not contain control characters or unpaired surrogates'),
  internalHosts: z.array(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)).min(1),
  ads: adsConfigSchema.optional(),
  ui: z.strictObject({
    statusBarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** The splash screen's background. Falls back to the status bar colour. */
    /** Pushes notifications to the app. Needs a build made after it was turned on. */
    push: z.boolean().optional(),
    splashColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    orientation: z.enum(['unspecified', 'portrait', 'landscape']),
    zoom: z.boolean(),
    progressBar: z.boolean(),
    pullToRefresh: z.boolean(),
    exitDialog: z.boolean(),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfigJsonSchema = z.toJSONSchema(appConfigSchema);
