import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api, ApiError } from '../api';
import { megabytes } from './build';

type InstallInfo = { appName: string; versionName: string; versionCode: number; artifactBytes: number };

type Problem = 'expired' | 'busy' | 'offline';

const PROBLEMS: Record<Problem, { title: string; text: string }> = {
  expired: { title: 'This link has expired', text: 'Install links work for 1 hour. Open the app’s build page on your computer and make a new one.' },
  busy: { title: 'Too many tries', text: 'Wait a few minutes, then open the link again.' },
  offline: { title: 'Couldn’t load the app', text: 'Check that this phone is online, then open the link again.' },
};

const REASONS = [
  { value: 'phishing', label: 'It tries to steal passwords, money or personal details' },
  { value: 'malware', label: 'It harms the phone or installs other things' },
  { value: 'impersonation', label: 'It pretends to be another company or person' },
  { value: 'other', label: 'Something else' },
];

/** Lets anyone tell us about a harmful app, with no account. */
const ReportForm = ({ token }: { token: string }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    try {
      await api('/reports', {
        method: 'POST',
        body: { token, reason, ...(details.trim() ? { details: details.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}) },
      });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  if (state === 'sent') return <p className="field-hint" role="status">Thanks. We’ll look at this app, and take it down if it breaks our rules.</p>;
  if (!open) return <button type="button" className="link-button small-link" onClick={() => setOpen(true)}>Report this app</button>;

  return (
    <form className="report stack" onSubmit={send}>
      <fieldset className="stack">
        <legend className="field-label">What’s wrong with it?</legend>
        {REASONS.map((item) => (
          <label key={item.value} className="toggle">
            <input type="radio" name="reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field-label">Details (optional)</span>
        <textarea rows={3} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Your email (optional)</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <span className="field-hint">Only if you’re happy for us to ask you about it.</span>
      </label>
      {state === 'failed' && <p className="form-error" role="alert">Couldn’t send the report. Try again in a few minutes.</p>}
      <button className="button button-quiet" disabled={!reason || state === 'sending'}>Send report</button>
    </form>
  );
};

/** The page a phone opens from the QR code. It needs no account. */
export const InstallPage = () => {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<InstallInfo | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    api<InstallInfo>(`/builds/install/${token}`).then(setInfo, (error) => {
      // Only a refused link is called expired. Anything else could work on the next try.
      if (error instanceof ApiError) setProblem(error.status === 429 ? 'busy' : error.status === 410 ? 'expired' : 'offline');
      else setProblem('offline');
    });
  }, [token]);

  if (problem) {
    return (
      <main className="account">
        <section className="account-card">
          <h1>{PROBLEMS[problem].title}</h1>
          <p>{PROBLEMS[problem].text}</p>
        </section>
      </main>
    );
  }
  if (!info) return <p className="loading">Loading…</p>;

  return (
    <main className="account">
      <section className="account-card install-card">
        <img src={`/builds/install/${token}/icon`} alt="" className="install-icon" />
        <h1>{info.appName}</h1>
        <p className="field-hint">Version {info.versionName} · {megabytes(info.artifactBytes)}</p>
        <a className="button" href={`/builds/install/${token}/download`}>Download the app</a>
        <ol className="install-steps">
          <li>Tap <strong>Download the app</strong>, then open the file when it finishes.</li>
          <li>If Android asks, allow your browser to install unknown apps, then go back.</li>
          <li>Tap <strong>Install</strong>. The app appears on your home screen.</li>
        </ol>
        <p className="field-hint">This app comes from outside Google Play, so Android may warn you. Install it only if you made it, or trust who sent the link.</p>
        <ReportForm token={token} />
      </section>
    </main>
  );
};
