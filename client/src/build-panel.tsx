import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from './api';
import type { BuildView } from './pages/build';
import { statusLabel } from './pages/build';

type Refusal = { reason?: string; buildId?: string; nextAllowedAt?: string };

const LIVE = ['queued', 'building', 'signing', 'uploading'];

/** Starts a build from the Review step, and explains a refusal in terms the user can act on. */
export const BuildPanel = ({ appId, latest, emailVerified }: { appId: string; latest?: BuildView; emailVerified: boolean }) => {
  const navigate = useNavigate();
  const [versionName, setVersionName] = useState(latest?.versionName ?? '1.0');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; buildId?: string } | null>(null);
  // One key per attempt, so a double click or a retried request starts one build.
  const [attempt, setAttempt] = useState(() => crypto.randomUUID());

  const validVersion = /^\d+(\.\d+){0,3}$/.test(versionName);
  const running = latest && LIVE.includes(latest.status);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const build = await api<BuildView>(`/apps/${appId}/builds`, { method: 'POST', body: { idempotencyKey: attempt, versionName } });
      navigate(`/my-apps/${appId}/builds/${build.id}`);
    } catch (error) {
      setAttempt(crypto.randomUUID());
      if (!(error instanceof ApiError)) return setMessage({ text: 'Couldn’t reach the server. Try again.' });
      const body = error.body as Refusal;
      if (body.reason === 'daily_limit' && body.nextAllowedAt) {
        const when = new Date(body.nextAllowedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        setMessage({ text: `You’ve used your 3 builds for the last 24 hours. The next one is free at ${when}.` });
      } else if (body.reason === 'build_running') {
        setMessage({ text: 'This app is already building.', buildId: body.buildId });
      } else {
        setMessage({ text: error.message });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!emailVerified) {
    return <div className="check check-bad" role="status"><p>Confirm your email to build. Use the link we sent, or ask for a new one at the top of the page.</p></div>;
  }

  return (
    <div className="build-panel">
      <div className="build-panel-row">
        <label className="field">
          <span className="field-label">Version name</span>
          <input
            type="text"
            className="mono"
            value={versionName}
            aria-invalid={!validVersion}
            onChange={(event) => setVersionName(event.target.value.trim())}
            aria-label="Version name"
          />
        </label>
        <button type="button" className="button" disabled={busy || !validVersion || Boolean(running)} onClick={start}>
          {busy ? 'Starting…' : 'Build app'}
        </button>
      </div>
      <p className="field-hint">
        {validVersion ? 'Shown to people as the app’s version, like 1.0 or 1.2.3. Free builds: 3 a day.' : 'Use digits and dots, like 1.0 or 1.2.3.'}
      </p>
      {latest && (
        <p className="field-hint">
          Latest build: <Link to={`/my-apps/${appId}/builds/${latest.id}`}>version {latest.versionName}, {statusLabel(latest).toLowerCase()}</Link>
        </p>
      )}
      {message && (
        <p className="form-error" role="alert">
          {message.text} {message.buildId && <Link to={`/my-apps/${appId}/builds/${message.buildId}`}>Follow it</Link>}
        </p>
      )}
    </div>
  );
};
