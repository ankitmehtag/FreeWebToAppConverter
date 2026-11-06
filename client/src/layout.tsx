import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { api } from './api';
import { useSession } from './session';

const VerifyBanner = () => {
  const [sent, setSent] = useState(false);
  const resend = async () => {
    await api('/auth/email/resend', { method: 'POST' }).catch(() => undefined);
    setSent(true);
  };
  return (
    <div className="banner" role="status">
      {sent ? (
        'We sent a new confirmation link. It works for 24 hours.'
      ) : (
        <>
          Confirm your email to build apps. You can set them up now.{' '}
          <button type="button" className="link-button" onClick={resend}>Send the link again</button>
        </>
      )}
    </div>
  );
};

const PUBLIC_LINKS = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'Questions' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/acceptable-use', label: 'Acceptable use' },
];

export const Layout = () => {
  const { me, signOut } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="wordmark" aria-label="Free Website to App Converter, home">
          website<span>→</span>app
        </Link>
        <nav className="topbar-nav" aria-label="Main">
          <Link to="/pricing" className="topbar-link">Pricing</Link>
          <Link to="/faq" className="topbar-link">Questions</Link>
          {me ? (
            <>
              <Link to="/my-apps" className="topbar-link">Your apps</Link>
              <span className="topbar-email">{me.email}</span>
              <button
                type="button"
                className="button button-quiet button-small"
                onClick={async () => {
                  await signOut();
                  navigate('/sign-in');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/sign-in" className="topbar-link">Sign in</Link>
              <Link to="/sign-up" className="button button-small">Get started</Link>
            </>
          )}
        </nav>
      </header>
      {me && !me.emailVerified && <VerifyBanner />}
      <Outlet />
      <footer className="footer">
        <nav aria-label="Site">
          {PUBLIC_LINKS.map((link) => (
            <Link key={link.to} to={link.to}>{link.label}</Link>
          ))}
        </nav>
        <p>Free Website to App Converter · Gurugram, India</p>
      </footer>
    </>
  );
};
