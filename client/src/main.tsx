import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './routes';
import { SessionProvider } from './session';
import './styles.css';

const app = (
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>
);

// A prerendered public page is hydrated, so nothing on it moves. Every other page starts empty.
const root = document.getElementById('root')!;
if (root.dataset.path === window.location.pathname) hydrateRoot(root, app);
else createRoot(root).render(app);
