import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type KeyStatus = { downloaded: boolean; sha1: string; sha256: string; eraseOn?: string };

const csrfToken = () => /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie)?.[1];

/** The Premium signing key: its fingerprints, and the one chance to download it. */
export const KeyPanel = ({ appId }: { appId: string }) => {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<KeyStatus>(`/keystores/${appId}`).then(setStatus, () => setStatus(null));
  }, [appId]);

  const download = async () => {
    if (busy || !understood) return;
    setBusy(true);
    setError('');
    try {
      // Not through `api`, which reads answers as JSON. The key arrives as a file.
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const token = csrfToken();
      if (token) headers['x-csrf-token'] = token;
      const response = await fetch(`/keystores/${appId}/download`, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ confirm: true }) });
      if (!response.ok) throw new ApiError(response.status, ((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t download the key');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `signing-key-${appId}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus((current) => current && { ...current, downloaded: true });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <div className="build-panel">
      <h3>Signing key</h3>
      <p className="field-hint">SHA-1 <span className="mono sha">{status.sha1}</span></p>
      <p className="field-hint">SHA-256 <span className="mono sha">{status.sha256}</span></p>
      {status.eraseOn && (
        <p className="check check-bad" role="status">This key will be erased on {new Date(status.eraseOn).toLocaleDateString()}. Download it before then.</p>
      )}
      {status.downloaded ? (
        <p className="hint">You have downloaded this key. We can’t give it out a second time, so keep your copy safe.</p>
      ) : (
        <>
          <p className="field-hint">
            Google Play only accepts updates signed with this key. Download it once and keep it somewhere safe. If you lose it, you can’t update your app on Google Play.
          </p>
          <label className="field">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />{' '}
            I understand that losing this key means no more updates on Google Play.
          </label>
          <button type="button" className="button" disabled={busy || !understood} onClick={download}>
            {busy ? 'Preparing…' : 'Download signing key'}
          </button>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
};
