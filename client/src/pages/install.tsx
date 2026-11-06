import { useEffect, useState } from 'react';
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
      </section>
    </main>
  );
};
