import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';

export type Row = Record<string, unknown> & { id: string };
export const when = (value: unknown) => (typeof value === 'string' ? new Date(value).toLocaleString() : '');
export const short = (id: unknown) => String(id).slice(-8);

/** Loads a list, and reloads after an action. */
export const useList = <T,>(path: string) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<T>(path).then((value) => { setData(value); setError(''); }, (failure) => setError(failure instanceof ApiError ? failure.message : 'Could not load'));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, load };
};

/** Runs an admin action after asking for the reason, which goes in the audit log. */
export const useAct = (reload: () => void) => {
  const [message, setMessage] = useState('');
  const act = async (label: string, path: string, body: Record<string, unknown> = {}) => {
    const reason = window.prompt(`${label}\nReason (kept in the audit log):`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/admin/api${path}`, { method: 'POST', body: { ...body, reason: reason.trim() } });
      setMessage(`${label}: done`);
      reload();
    } catch (failure) {
      setMessage(`${label}: ${failure instanceof ApiError ? failure.message : 'failed'}`);
    }
  };
  return { act, message: message && <p className="field-hint" role="status">{message}</p> };
};

export const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div style={{ overflowX: 'auto' }}>
    <table>
      <thead><tr>{head.map((name) => <th key={name} align="left">{name}</th>)}</tr></thead>
      <tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export const Failure = ({ message }: { message: string }) => (message ? <p className="form-error" role="alert">{message}</p> : null);

