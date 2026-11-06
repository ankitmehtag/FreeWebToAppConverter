import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './layout';
import { ForgotPassword, ResetPassword, SignIn, SignUp, VerifyEmail } from './pages/account';
import { AppsList } from './pages/apps';
import { Wizard } from './pages/wizard';
import { RequireSignIn, SessionProvider, useSession } from './session';
import './styles.css';

// Google sign-in lands on the root, so a signed-in visitor goes straight to their apps.
const Home = () => {
  const { me } = useSession();
  if (me === undefined) return <p className="loading">Loading…</p>;
  return <Navigate to={me ? '/my-apps' : '/sign-in'} replace />;
};

const signedIn = (page: ReactNode) => <RequireSignIn>{page}</RequireSignIn>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="sign-up" element={<SignUp />} />
            <Route path="sign-in" element={<SignIn />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="verify-email" element={<VerifyEmail />} />
            <Route path="my-apps" element={signedIn(<AppsList />)} />
            <Route path="my-apps/:id/:step?" element={signedIn(<Wizard />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
