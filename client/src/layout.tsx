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

export const Layout = () => {
  const { me, signOut } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <header className="topbar">
        <Link to={me ? '/my-apps' : '/'} className="wordmark">
          website<span>→</span>app
        </Link>
        {me && (
          <nav className="topbar-nav">
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
          </nav>
        )}
      </header>
      {me && !me.emailVerified && <VerifyBanner />}
      <Outlet />
    </>
  );
};
