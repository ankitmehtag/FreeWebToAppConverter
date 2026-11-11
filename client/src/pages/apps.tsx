import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Draft } from '@sitetoapk/shared';
import { api, ApiError } from '../api';
import { pendingSite } from '../url-check';
import { statusLabel, type BuildView } from './build';

export type AppView = {
  id: string;
  draft: Draft;
  ready: boolean;
  locked: boolean;
  hasIcon: boolean;
  latestBuild?: BuildView;
  plan?: 'free' | 'premium';
  /** A Premium app whose people installed Free builds: the first Premium build uses a new key, so they must reinstall. */
  reinstallWarning?: boolean;
  takenDown?: { reason: string; at: string };
  createdAt: string;
  updatedAt: string;
};

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

export const AppsList = () => {
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // A site checked on Home before signing in becomes this visitor's next app.
    const site = pendingSite.get();
    if (site) {
      pendingSite.clear();
      api<AppView>('/apps', { method: 'POST', body: {} }).then(
        (app) => navigate(`/my-apps/${app.id}/basics?site=${encodeURIComponent(site)}`, { replace: true }),
        () => setError('Couldn’t start an app for your site. Use New app to try again.'),
      );
    }
    api<AppView[]>('/apps').then(setApps, () => setError('Couldn’t load your apps. Refresh to try again.'));
  }, [navigate]);

  const create = async () => {
    setError('');
    try {
      const app = await api<AppView>('/apps', { method: 'POST', body: {} });
      navigate(`/my-apps/${app.id}/basics`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t create the app. Try again.');
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Your apps</h1>
        <button type="button" className="button" onClick={create}>New app</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {apps === null && !error && <p className="loading">Loading…</p>}
      {apps?.length === 0 && (
        <div className="empty">
          <p>Paste your website’s address and we’ll set up an Android app around it.</p>
          <button type="button" className="button" onClick={create}>Make your first app</button>
        </div>
      )}
      {apps && apps.length > 0 && (
        <ul className="app-list">
          {apps.map((app) => (
            <li key={app.id}>
              <Link to={`/my-apps/${app.id}/basics`} className="app-row">
                {app.hasIcon ? (
                  <img src={`/apps/${app.id}/icon?v=${encodeURIComponent(app.updatedAt)}`} alt="" className="app-row-icon" />
                ) : (
                  <span className="app-row-icon app-row-icon-empty" aria-hidden="true" />
                )}
                <span className="app-row-text">
                  <span className="app-row-name">{app.draft.appName || 'Untitled app'}</span>
                  <span className="mono app-row-host">{hostOf(app.draft.startUrl) || 'No website yet'}</span>
                </span>
                <span className={`tag ${app.latestBuild?.status === 'success' && !app.latestBuild.expired ? 'tag-ready' : app.latestBuild?.status === 'failed' ? 'tag-failed' : ''}`}>
                  {app.latestBuild ? `v${app.latestBuild.versionName} · ${statusLabel(app.latestBuild)}` : app.ready ? 'Ready to build' : 'Draft'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};
