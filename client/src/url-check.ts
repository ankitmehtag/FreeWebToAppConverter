/** The answer from `/url/check`, shared by the wizard and the checker on Home. */
export type UrlCheck =
  | { reachable: true; https: boolean; mobileReady: boolean | 'unknown'; embeddable: boolean }
  | { reachable: false; failure: string };

export const FAILURES: Record<string, string> = {
  invalid_url: 'That isn’t a web address we can open. Check it and try again.',
  blocked: 'That address points to a private network, so it can’t become an app.',
  unreachable: 'We couldn’t reach that site. Check the address, or try again once the site is up.',
  timeout: 'The site took longer than 10 seconds to answer. Try again in a moment.',
  too_large: 'The page is larger than 2 MB, so we couldn’t check it.',
  unsafe: 'This site is on a list of unsafe sites, such as malware or phishing, so it can’t become an app.',
  rate: 'Too many checks in a short time. Wait a few minutes and try again.',
};

export const failureText = (failure: string) => FAILURES[failure] ?? FAILURES.unreachable!;

/** A site can become an app only when it answers over HTTPS. */
export const passes = (check?: UrlCheck) => Boolean(check?.reachable && check.https);

/** Adds https:// when someone types just a domain. */
export const normaliseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const PENDING_KEY = 'pending-site';

/** A site checked on Home, carried in this browser to the visitor's first app. */
export const pendingSite = {
  get: () => {
    try {
      return localStorage.getItem(PENDING_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (url: string) => {
    try {
      localStorage.setItem(PENDING_KEY, url);
    } catch {
      // Without storage the visitor types the address again in the wizard.
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};
