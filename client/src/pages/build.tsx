import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import QRCode from 'qrcode';
import { api, ApiError } from '../api';

export type BuildView = {
  id: string;
  appId?: string;
  status: string;
  versionCode: number;
  versionName: string;
  failureKind?: 'input' | 'compile' | 'timeout' | 'check' | 'infra';
  artifactBytes?: number;
  sha256?: string;
  expiresAt?: string;
  expired: boolean;
  createdAt: string;
};

type LogLine = { n: number; text: string };

const STAGES = [
  { status: 'queued', label: 'Waiting' },
  { status: 'building', label: 'Building' },
  { status: 'signing', label: 'Checking' },
  { status: 'uploading', label: 'Saving' },
  { status: 'success', label: 'Ready' },
];

export const FAILURES: Record<NonNullable<BuildView['failureKind']>, string> = {
  input: 'We couldn’t use this app’s settings. Check them on the Review step, then build again.',
  compile: 'The app failed while compiling. Check the log below, then try again.',
  timeout: 'The build took longer than 15 minutes, so we stopped it. Try again.',
  check: 'The finished APK failed our checks, so we didn’t keep it. Try again.',
  infra: 'Something failed on our side. This build doesn’t count toward your 3 builds a day. Try again.',
};

export const statusLabel = (build: Pick<BuildView, 'status' | 'expired'>) => {
  if (build.status === 'success') return build.expired ? 'Expired' : 'Ready';
  if (build.status === 'failed') return 'Failed';
  return STAGES.find((stage) => stage.status === build.status)?.label ?? build.status;
};

export const megabytes = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const InstallOnPhone = ({ buildId }: { buildId: string }) => {
  const [link, setLink] = useState<{ url: string; expiresAt: string; qr: string } | null>(null);
  const [error, setError] = useState('');

  const make = async () => {
    setError('');
    try {
      const made = await api<{ url: string; expiresAt: string }>(`/builds/${buildId}/install-link`, { method: 'POST' });
      // Drawn here, so the link never passes through another service.
      const qr = await QRCode.toDataURL(made.url, { margin: 1, width: 240, color: { dark: '#10302e', light: '#ffffff' } });
      setLink({ ...made, qr });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t make the link. Try again.');
    }
  };

  if (!link) {
    return (
      <div className="stack">
        <button type="button" className="button button-quiet" onClick={make}>Install on a phone</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <div className="install-qr">
      <img src={link.qr} alt="QR code for the install page" width={240} height={240} />
      <div className="stack">
        <p>Scan this with your Android phone’s camera. It opens a page to download the app, with no sign-in.</p>
        <p className="field-hint">
          The link works until {new Date(link.expiresAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}. Anyone with it can
          download this APK until then.
        </p>
        <a className="mono small-link install-url" href={link.url}>{link.url}</a>
      </div>
    </div>
  );
};

export const BuildPage = () => {
  const { id: appId = '', buildId = '' } = useParams();
  const [build, setBuild] = useState<BuildView | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [history, setHistory] = useState<BuildView[]>([]);
  const [missing, setMissing] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    let source: EventSource | null = null;
    let stopped = false;
    setLines([]);

    const load = () =>
      api<BuildView>(`/builds/${buildId}`).then(setBuild, (error) => {
        if (error instanceof ApiError && error.status === 404) setMissing(true);
      });

    const open = () => {
      source = new EventSource(`/builds/${buildId}/events`);
      source.addEventListener('line', (event) => {
        const line = JSON.parse((event as MessageEvent).data) as LogLine;
        setLines((current) => (current.length && current[current.length - 1]!.n >= line.n ? current : [...current, line]));
      });
      source.addEventListener('status', () => void load());
      source.addEventListener('end', () => {
        source?.close();
        void load();
        void api<BuildView[]>(`/apps/${appId}/builds`).then(setHistory, () => undefined);
      });
      // The access token lasts 15 minutes. Reading the build renews it, then the stream reopens.
      source.onerror = () => {
        source?.close();
        if (stopped) return;
        setTimeout(() => void load().then(() => !stopped && open()), 2000);
      };
    };

    void load();
    void api<BuildView[]>(`/apps/${appId}/builds`).then(setHistory, () => undefined);
    open();
    return () => {
      stopped = true;
      source?.close();
    };
  }, [appId, buildId]);

  useEffect(() => {
    if (follow.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  if (missing) return <main className="page"><p>This build doesn’t exist, or isn’t yours. <Link to="/my-apps">Go to your apps</Link></p></main>;
  if (!build) return <p className="loading">Loading…</p>;

  const reached = STAGES.findIndex((stage) => stage.status === build.status);
  const failed = build.status === 'failed';
  const ready = build.status === 'success' && !build.expired;

  return (
    <main className="page build-page">
      <Link to={`/my-apps/${appId}/review`} className="small-link">← Back to the app</Link>
      <div className="page-head">
        <h1>Version {build.versionName} <span className="mono build-code">({build.versionCode})</span></h1>
        <span className={`tag ${ready ? 'tag-ready' : failed ? 'tag-failed' : ''}`}>{statusLabel(build)}</span>
      </div>

      {!failed && (
        <ol className="stages" aria-label="Build progress">
          {STAGES.map((stage, index) => (
            <li key={stage.status} className={index < reached ? 'stage-done' : index === reached ? 'stage-now' : ''}>
              {stage.label}
            </li>
          ))}
        </ol>
      )}

      {failed && (
        <div className="check check-bad" role="alert">
          <p>{FAILURES[build.failureKind ?? 'infra']}</p>
          <Link to={`/my-apps/${appId}/review`} className="small-link">{build.failureKind === 'input' ? 'Check the settings' : 'Try again'}</Link>
        </div>
      )}

      {build.status === 'success' && build.expired && (
        <div className="check check-bad" role="status">
          <p>Free builds are kept for 7 days, and this one has expired.</p>
          <Link to={`/my-apps/${appId}/review`} className="small-link">Start a new build</Link>
        </div>
      )}

      {ready && (
        <section className="build-ready">
          <div className="build-actions">
            <a className="button" href={`/builds/${build.id}/download`}>Download APK</a>
            <span className="field-hint">{megabytes(build.artifactBytes)} · kept until {date(build.expiresAt!)}</span>
          </div>
          <p className="field-hint">SHA-256 <span className="mono sha">{build.sha256}</span></p>
          <InstallOnPhone buildId={build.id} />
        </section>
      )}

      <section>
        <h2 className="section-title">Build log</h2>
        <pre
          className="log"
          ref={logRef}
          tabIndex={0}
          aria-label="Build log"
          onScroll={(event) => {
            const box = event.currentTarget;
            follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          }}
        >
          {lines.length ? lines.map((line) => `${line.text}\n`).join('') : build.status === 'queued' ? 'Waiting for a build server…' : ''}
        </pre>
      </section>

      {history.length > 1 && (
        <section>
          <h2 className="section-title">Earlier builds</h2>
          <ul className="history">
            {history.map((item) => (
              <li key={item.id}>
                <Link to={`/my-apps/${appId}/builds/${item.id}`} aria-current={item.id === build.id ? 'page' : undefined}>
                  <span>Version {item.versionName} ({item.versionCode})</span>
                  <span className="field-hint">{date(item.createdAt)}</span>
                  <span className="field-hint">{megabytes(item.artifactBytes)}</span>
                  <span className="tag">{statusLabel(item)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
};
