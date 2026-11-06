import { z } from 'zod';
import { appConfigSchema, JAVA_RESERVED_WORDS, type AppConfig } from './app-config';

const fields = appConfigSchema.shape;

/** The wizard's saved fields: the same rules as `app_config`, with every field optional. */
export const draftSchema = z.strictObject({
  startUrl: fields.startUrl.optional(),
  appName: fields.appName.optional(),
  packageName: fields.packageName.optional(),
  internalHosts: fields.internalHosts.optional(),
  ui: fields.ui.partial().optional(),
});

export type Draft = z.infer<typeof draftSchema>;

/** Behaviour a user hasn't changed. The colour has no default, because Branding asks for it. */
export const DEFAULT_BEHAVIOUR = {
  orientation: 'unspecified',
  zoom: false,
  progressBar: true,
  pullToRefresh: true,
  exitDialog: true,
} as const;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

/** Renders a draft into an `app_config`, or returns null while anything is missing or invalid. */
export const toAppConfig = (draft: Draft): AppConfig | null => {
  const host = draft.startUrl ? hostOf(draft.startUrl) : undefined;
  const result = appConfigSchema.safeParse({
    schemaVersion: 1,
    startUrl: draft.startUrl,
    appName: draft.appName,
    packageName: draft.packageName,
    internalHosts: draft.internalHosts ?? (host ? [host] : undefined),
    ui: { ...DEFAULT_BEHAVIOUR, ...draft.ui },
  });
  return result.success ? result.data : null;
};

const segment = (label: string) => {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const named = /^[a-z]/.test(cleaned) ? cleaned : `x${cleaned}`;
  return JAVA_RESERVED_WORDS.has(named) ? `${named}_` : named;
};

/** Suggests a package name from a host, such as `com.example.app` for `www.example.com`. */
export const suggestPackageName = (host: string) => {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return [...labels.reverse().map(segment), 'app'].join('.');
};

export const INTERNET = 'android.permission.INTERNET';

/** The Android permissions an app asks for. Each feature that needs one adds it here. */
export const permissionsFor = (_config: AppConfig) => [INTERNET];
