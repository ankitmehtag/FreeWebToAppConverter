export type Plan = 'free' | 'premium';

/** Anything that isn't exactly "premium" is Free, so a missing or odd value never unlocks Premium. */
export const planOf = (app: object | null | undefined): Plan => ((app as { plan?: unknown } | null | undefined)?.plan === 'premium' ? 'premium' : 'free');
