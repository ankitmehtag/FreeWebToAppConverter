export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: FieldErrors = {},
    /** The whole answer, for refusals that carry more, such as when to try again. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; raw?: Blob };

const csrfToken = () => /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie)?.[1];

/** Whether this browser may hold a session. Without the CSRF cookie there is none, so there is nothing to ask. */
export const mayBeSignedIn = () => Boolean(csrfToken());

// Refreshing again from these would loop, or hide a wrong password behind a refresh.
const NO_RETRY = new Set(['/auth/refresh', '/auth/login', '/auth/register']);

const send = (path: string, { method = 'GET', body, raw }: Options) => {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = raw.type || 'application/octet-stream';
  const token = csrfToken();
  if (method !== 'GET' && token) headers['x-csrf-token'] = token;
  return fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
};

/** Calls the API, renewing the session once when the short-lived access token has run out. */
export const api = async <T = unknown>(path: string, options: Options = {}): Promise<T> => {
  let response = await send(path, options);
  if (response.status === 401 && !NO_RETRY.has(path)) {
    const refreshed = await send('/auth/refresh', { method: 'POST' });
    if (refreshed.ok) response = await send(path, options);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Something went wrong', data.fields, data);
  return data as T;
};
