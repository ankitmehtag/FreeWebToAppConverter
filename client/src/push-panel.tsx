import { useState } from 'react';
import { api, ApiError } from './api';

/** Sends a notification to everyone who has the app. Shown once the app has been built with push on. */
export const PushPanel = ({ appId }: { appId: string }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const send = async () => {
    if (busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/apps/${appId}/push`, { method: 'POST', body: { title, body } });
      setMessage({ text: 'Sent. It reaches phones within a minute or so.', ok: true });
      setTitle('');
      setBody('');
    } catch (error) {
      setMessage({ text: error instanceof ApiError ? error.message : 'Couldn’t reach the server. Try again.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="build-panel">
      <h3>Send a notification</h3>
      <label className="field">
        <span className="field-label">Title</span>
        <input type="text" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Message</span>
        <textarea maxLength={200} rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
        <span className="field-hint">Up to 5 a day per app. Only phones that installed a build made with push on will get it.</span>
      </label>
      <button type="button" className="button" disabled={busy || !title.trim() || !body.trim()} onClick={send}>
        {busy ? 'Sending…' : 'Send to everyone'}
      </button>
      {message && <p role="status" className={message.ok ? 'hint' : 'check check-bad'}>{message.text}</p>}
    </div>
  );
};
