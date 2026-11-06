import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './layout';
import { ForgotPassword, ResetPassword, SignIn, SignUp, VerifyEmail } from './pages/account';
import { AppsList } from './pages/apps';
import { BuildPage } from './pages/build';
import { Home } from './pages/home';
import { About, Contact, Faq, Pricing } from './pages/info';
import { InstallPage } from './pages/install';
import { AcceptableUse, Privacy, Terms } from './pages/legal';
import { Wizard } from './pages/wizard';
import { RequireSignIn } from './session';

const signedIn = (page: ReactNode) => <RequireSignIn>{page}</RequireSignIn>;

/** Every page, shared by the browser and the prerender, so both show the same thing. */
export const AppRoutes = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<Home />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="faq" element={<Faq />} />
      <Route path="about" element={<About />} />
      <Route path="contact" element={<Contact />} />
      <Route path="terms" element={<Terms />} />
      <Route path="privacy" element={<Privacy />} />
      <Route path="acceptable-use" element={<AcceptableUse />} />
      <Route path="sign-up" element={<SignUp />} />
      <Route path="sign-in" element={<SignIn />} />
      <Route path="forgot-password" element={<ForgotPassword />} />
      <Route path="reset-password" element={<ResetPassword />} />
      <Route path="verify-email" element={<VerifyEmail />} />
      <Route path="my-apps" element={signedIn(<AppsList />)} />
      <Route path="my-apps/:id/builds/:buildId" element={signedIn(<BuildPage />)} />
      <Route path="my-apps/:id/:step?" element={signedIn(<Wizard />)} />
      <Route path="install/:token" element={<InstallPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
);
