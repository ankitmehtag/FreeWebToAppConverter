import { useEffect } from 'react';

/** The public address. Canonical links, the sitemap and share tags all point here. */
export const SITE_URL = 'https://freewebsitetoappconverter.com';
export const SITE_NAME = 'Free Website to App Converter';

export const OPERATOR = {
  name: 'Ankit',
  place: 'Gurugram (Gurgaon), Haryana, India',
  law: 'India',
  email: 'support@freewebsitetoappconverter.com',
};

export type PublicPage = { path: string; title: string; description: string };

/** Every page search engines may show. The prerender and the sitemap both read this list. */
export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: `${SITE_NAME}: turn your website into an Android app`,
    description: 'Paste your website’s address and get an Android app (APK) you can install today. Free, with your own name, icon and colours.',
  },
  {
    path: '/pricing',
    title: `Pricing | ${SITE_NAME}`,
    description: 'The Free plan builds a signed Android APK of your website, 3 times a day. Premium, with Google Play bundles and no watermark, is coming soon.',
  },
  {
    path: '/faq',
    title: `Questions and answers | ${SITE_NAME}`,
    description: 'How the converter works, what your app can do, and what Google Play expects from apps built from websites.',
  },
  {
    path: '/about',
    title: `About | ${SITE_NAME}`,
    description: 'Who runs Free Website to App Converter, and why.',
  },
  {
    path: '/contact',
    title: `Contact | ${SITE_NAME}`,
    description: 'How to reach us about your account, an app, or a report.',
  },
  {
    path: '/terms',
    title: `Terms of Service | ${SITE_NAME}`,
    description: 'The terms for using Free Website to App Converter.',
  },
  {
    path: '/privacy',
    title: `Privacy Policy | ${SITE_NAME}`,
    description: 'What we store about you and your apps, who processes it, and how long we keep it.',
  },
  {
    path: '/acceptable-use',
    title: `Acceptable Use Policy | ${SITE_NAME}`,
    description: 'What apps you may not build with Free Website to App Converter, and how to report one.',
  },
];

export const pageFor = (path: string) => PUBLIC_PAGES.find((page) => page.path === path);

/** Keeps the tab title and description in step with the page, as the prerender wrote them. */
export const usePageMeta = (path: string) => {
  useEffect(() => {
    const page = pageFor(path);
    if (!page) return;
    document.title = page.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
  }, [path]);
};
