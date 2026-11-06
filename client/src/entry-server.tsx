import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { AppRoutes } from './routes';
import { SessionProvider } from './session';

/** Renders a public page to HTML at build time, as a signed-out visitor sees it. */
export const render = (path: string) =>
  renderToString(
    <StrictMode>
      <StaticRouter location={path}>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </StaticRouter>
    </StrictMode>,
  );

export { PUBLIC_PAGES, SITE_NAME, SITE_URL } from './site';
export { fileFor, headTags, sitemap } from './seo';
