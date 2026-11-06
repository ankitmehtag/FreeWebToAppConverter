import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { safeNext, useSession } from '../session';

const AccountCard = ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => (
  <main className="account">
    <section className="account-card">
      <h1>{title}</h1>
      {children}
    </section>
    {footer && <p className="account-footer">{footer}</p>}
  </main>
);

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Couldn’t reach the server. Check your connection and try again.');

/** Runs a form action, showing its error and stopping double submits. */
const useSubmit = (action: () => Promise<void>) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
};

const Field = ({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) => (
  <label className="field">
    <span className="field-label">{label}</span>
    <input {...input} />
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

const GoogleButton = () => (
  <a className="button button-quiet" href="/auth/google">
    Continue with Google
  </a>
);

export const SignUp = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/register', { method: 'POST', body: { email, password } });
    setSent(true);
  });

  if (sent) {
    return (
      <AccountCard title="Check your email" footer={<Link to="/sign-in">Go to sign in</Link>}>
        <p>
          We sent a link to <strong>{email}</strong>. Open it to confirm your address, then sign in. If you already have an
          account, the email tells you how to get back in.
        </p>
      </AccountCard>
    );
  }

  return (
    <AccountCard title="Create your account" footer={<>Already have an account? <Link to="/sign-in">Sign in</Link></>}>
      <form onSubmit={submit} className="stack">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint="At least 10 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="field-hint consent">
          By creating an account, you accept the <Link to="/terms">Terms of Service</Link>. Read how we handle your data in the{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <button className="button" disabled={busy}>Create account</button>
      </form>
      <div className="divider">or</div>
      <GoogleButton />
    </AccountCard>
  );
};

export const SignIn = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    await reload();
    navigate(safeNext(params.get('next')), { replace: true });
  });

  return (
    <AccountCard title="Sign in" footer={<>New here? <Link to="/sign-up">Create an account</Link></>}>
      <form onSubmit={submit} className="stack">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button" disabled={busy}>Sign in</button>
        <Link to="/forgot-password" className="small-link">Forgot your password?</Link>
      </form>
      <div className="divider">or</div>
      <GoogleButton />
    </AccountCard>
  );
};

export const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/password/forgot', { method: 'POST', body: { email } });
    setSent(true);
  });

  if (sent) {
    return (
      <AccountCard title="Check your email" footer={<Link to="/sign-in">Back to sign in</Link>}>
        <p>If <strong>{email}</strong> has an account, we sent it a link to choose a new password. The link works for 1 hour.</p>
      </AccountCard>
    );
  }

  return (
    <AccountCard title="Reset your password" footer={<Link to="/sign-in">Back to sign in</Link>}>
      <form onSubmit={submit} className="stack">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button" disabled={busy}>Send reset link</button>
      </form>
    </AccountCard>
  );
};

export const ResetPassword = () => {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/password/reset', { method: 'POST', body: { token: params.get('token') ?? '', password } });
    setDone(true);
  });

  if (done) {
    return (
      <AccountCard title="Password changed" footer={<Link to="/sign-in">Sign in</Link>}>
        <p>Your new password is set, and you’ve been signed out everywhere else.</p>
      </AccountCard>
    );
  }

  return (
    <AccountCard title="Choose a new password">
      <form onSubmit={submit} className="stack">
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint="At least 10 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error === 'Invalid or expired link' ? 'This link has expired or was already used. Ask for a new one.' : error}{' '}
            <Link to="/forgot-password">Send a new link</Link>
          </p>
        )}
        <button className="button" disabled={busy}>Save password</button>
      </form>
    </AccountCard>
  );
};

export const VerifyEmail = () => {
  const [params] = useSearchParams();
  const { me, reload } = useSession();
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking');
  const started = useRef(false);

  useEffect(() => {
    // A link works once, so React's double effect in development must not spend it twice.
    if (started.current) return;
    started.current = true;
    api('/auth/email/verify', { method: 'POST', body: { token: params.get('token') ?? '' } })
      .then(async () => {
        setState('done');
        await reload();
      })
      .catch(() => setState('failed'));
  }, [params, reload]);

  if (state === 'checking') return <AccountCard title="Confirming your email…"><p>One moment.</p></AccountCard>;
  if (state === 'done') {
    return (
      <AccountCard title="Email confirmed" footer={<Link to={me ? '/my-apps' : '/sign-in'}>{me ? 'Go to my apps' : 'Sign in'}</Link>}>
        <p>Your address is confirmed. You’ll be able to build apps once they’re ready.</p>
      </AccountCard>
    );
  }
  return (
    <AccountCard title="This link didn’t work" footer={<Link to="/sign-in">Sign in</Link>}>
      <p>It has expired or was already used. Sign in and ask for a new confirmation email from your apps page.</p>
    </AccountCard>
  );
};
