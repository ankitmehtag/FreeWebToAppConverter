import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Draft } from '@sitetoapk/shared';
import { api, ApiError } from '../api';

export type AppView = {
  id: string;
  draft: Draft;
  ready: boolean;
  locked: boolean;
  hasIcon: boolean;
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
    api<AppView[]>('/apps').then(setApps, () => setError('Couldn’t load your apps. Refresh to try again.'));
  }, []);

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
                <span className={`tag ${app.ready ? 'tag-ready' : ''}`}>{app.ready ? 'Ready to build' : 'Draft'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};
