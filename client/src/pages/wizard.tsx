import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { DEFAULT_BEHAVIOUR, draftSchema, permissionsFor, suggestPackageName, toAppConfig, type Draft } from '@sitetoapk/shared';
import { api, ApiError, type FieldErrors } from '../api';
import { BuildPanel } from '../build-panel';
import { PhonePreview } from '../preview';
import { failureText, normaliseUrl, passes, type UrlCheck } from '../url-check';
import { useSession } from '../session';
import type { AppView } from './apps';

type Prefill = { reachable: true; appName?: string; statusBarColor?: string; icon?: string } | { reachable: false };

const STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'branding', label: 'Branding' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'review', label: 'Review' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const SAVE_DELAY_MS = 600;

const MESSAGES: Record<string, string> = {
  startUrl: 'Enter the full address, starting with https://',
  appName: 'Use 1 to 50 characters, with no hidden control characters.',
  packageName: 'Use lowercase words joined by dots, like com.example.app. Each word starts with a letter and can’t be a Java keyword.',
  'ui.statusBarColor': 'Pick a colour, or type it as #RRGGBB.',
  internalHosts: 'List each host on its own line, like shop.example.com.',
};

/** Checks the draft with the same rules as the server, and words each problem for people. */
const validate = (draft: Draft): FieldErrors => {
  const result = draftSchema.safeParse(draft);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      const field = path.startsWith('internalHosts') ? 'internalHosts' : path;
      return [field, MESSAGES[field] ?? 'Check this value.'];
    }),
  );
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

// The check result is kept per tab, so a refresh shows the preview again without spending a check.
const cachedCheck = (url: string): UrlCheck | undefined => {
  try {
    const raw = sessionStorage.getItem(`check:${url}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const cacheCheck = (url: string, check: UrlCheck) => {
  try {
    sessionStorage.setItem(`check:${url}`, JSON.stringify(check));
  } catch {
    // Without storage the site is just checked again next time.
  }
};

const Field = ({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) => (
  <div className="field">
    <span className="field-label">{label}</span>
    {children}
    {error ? <span className="field-error" role="alert">{error}</span> : hint && <span className="field-hint">{hint}</span>}
  </div>
);

const Offer = ({ children, onAccept }: { children: ReactNode; onAccept: () => void }) => (
  <div className="offer">
    <span>{children}</span>
    <button type="button" className="button button-quiet button-small" onClick={onAccept}>Use it</button>
  </div>
);

const Toggle = ({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-text">
      <span className="toggle-label">{label}</span>
      <span className="field-hint">{hint}</span>
    </span>
  </label>
);

const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export const Wizard = () => {
  const { id = '', step = 'basics' } = useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const [app, setApp] = useState<AppView | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [urlInput, setUrlInput] = useState('');
  const [check, setCheck] = useState<UrlCheck | undefined>();
  const [checking, setChecking] = useState(false);
  const [offer, setOffer] = useState<Prefill | null>(null);
  const [iconError, setIconError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [hostsText, setHostsText] = useState('');
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(draft);
  latest.current = draft;

  const errors = { ...serverErrors, ...validate(draft) };
  const config = toAppConfig(draft);

  useEffect(() => {
    api<AppView>(`/apps/${id}`).then(
      (loaded) => {
        setApp(loaded);
        setDraft(loaded.draft);
        setUrlInput(loaded.draft.startUrl ?? '');
        setHostsText((loaded.draft.internalHosts ?? []).join('\n'));
        if (loaded.draft.startUrl) setCheck(cachedCheck(loaded.draft.startUrl));
      },
      (error) => {
        if (error instanceof ApiError && error.status === 404) setMissing(true);
      },
    );
  }, [id]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return true;
    const current = latest.current;
    if (Object.keys(validate(current)).length > 0) {
      setSaveState('unsaved');
      return false;
    }
    dirty.current = false;
    setSaveState('saving');
    try {
      const saved = await api<AppView>(`/apps/${id}`, { method: 'PUT', body: current });
      setApp(saved);
      setServerErrors({});
      setSaveState(dirty.current ? 'unsaved' : 'saved');
      return true;
    } catch (error) {
      dirty.current = true;
      setServerErrors(error instanceof ApiError ? error.fields : {});
      setSaveState('failed');
      return false;
    }
  }, [id]);

  const update = (change: (draft: Draft) => Draft) => {
    dirty.current = true;
    setSaveState('unsaved');
    setDraft((current) => change(current));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K] | undefined) =>
    update((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const setUi = (change: NonNullable<Draft['ui']>) => update((current) => ({ ...current, ui: { ...current.ui, ...change } }));

  // Saves anything pending when the page is left.
  useEffect(() => () => void save(), [save]);

  const runCheck = async (value = urlInput) => {
    const url = normaliseUrl(value);
    if (!url) return;
    setUrlInput(url);
    setChecking(true);
    setOffer(null);
    try {
      const result = await api<UrlCheck>('/url/check', { method: 'POST', body: { url } });
      setCheck(result);
      if (!passes(result)) return;
      cacheCheck(url, result);
      update((current) => ({
        ...current,
        startUrl: url,
        packageName: current.packageName ?? (app?.locked ? undefined : suggestPackageName(hostOf(url))),
      }));
      api<Prefill>('/apps/prefill', { method: 'POST', body: { url } }).then(setOffer, () => undefined);
    } catch (error) {
      setCheck({ reachable: false, failure: error instanceof ApiError && error.status === 429 ? 'rate' : 'unreachable' });
    } finally {
      setChecking(false);
    }
  };

  // After a refresh the URL is checked again once, so the preview knows whether it can embed the site.
  // A site carried from Home is filled in and checked once, like a typed one.
  const [params] = useSearchParams();
  const carried = useRef(false);
  useEffect(() => {
    const site = params.get('site');
    if (!app || carried.current || !site || app.draft.startUrl) return;
    carried.current = true;
    setUrlInput(site);
    void runCheck(site);
    // runCheck changes on every render; this runs once per app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, params]);

  const rechecked = useRef(false);
  useEffect(() => {
    if (!app || rechecked.current || !app.draft.startUrl || cachedCheck(app.draft.startUrl)) return;
    rechecked.current = true;
    api<UrlCheck>('/url/check', { method: 'POST', body: { url: app.draft.startUrl } }).then(
      (result) => {
        setCheck(result);
        if (passes(result)) cacheCheck(app.draft.startUrl!, result);
      },
      () => undefined,
    );
  }, [app]);

  const uploadIcon = async (file: Blob) => {
    setIconError('');
    setUploading(true);
    try {
      setApp(await api<AppView>(`/apps/${id}/icon`, { method: 'POST', raw: file }));
    } catch (error) {
      setIconError(error instanceof ApiError ? (error.fields.icon ?? error.message) : 'Couldn’t upload the icon. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const go = async (target: StepId) => {
    await save();
    navigate(`/my-apps/${id}/${target}`);
  };

  if (missing) return <Navigate to="/my-apps" replace />;
  if (!STEPS.some((item) => item.id === step)) return <Navigate to={`/my-apps/${id}/basics`} replace />;
  if (!app) return <p className="loading">Loading…</p>;

  const index = STEPS.findIndex((item) => item.id === step);
  const urlChanged = normaliseUrl(urlInput) !== (draft.startUrl ?? '');
  const canLeaveBasics = Boolean(draft.startUrl) && !urlChanged && !errors.startUrl && (check === undefined || passes(check));
  const iconUrl = app.hasIcon ? `/apps/${id}/icon?v=${encodeURIComponent(app.updatedAt)}` : undefined;
  const offered = offer?.reachable ? offer : undefined;
  const ui = { ...DEFAULT_BEHAVIOUR, ...draft.ui };
  const missingItems = [
    !draft.startUrl && 'a checked website',
    !draft.appName && 'an app name',
    !draft.packageName && 'a package name',
    !draft.ui?.statusBarColor && 'a colour',
    !app.hasIcon && 'an icon',
  ].filter(Boolean) as string[];

  const saveLabel = {
    saved: 'All changes saved',
    saving: 'Saving…',
    unsaved: Object.keys(validate(draft)).length ? 'Fix the highlighted fields to save' : 'Unsaved changes',
    failed: 'Couldn’t save. Check the highlighted fields.',
  }[saveState];

  return (
    <main className="wizard">
      {app.takenDown && (
        <div className="check check-bad taken-down" role="alert">
          <p>
            This app was taken down: {app.takenDown.reason}. It can’t be changed or built, and its APKs were removed. If you think this
            is a mistake, contact us and give the app’s name.
          </p>
        </div>
      )}
      <div className="wizard-head">
        <Link to="/my-apps" className="small-link">← Your apps</Link>
        <h1>{draft.appName || 'New app'}</h1>
        <ol className="steps">
          {STEPS.map((item, position) => {
            const open = position === 0 || canLeaveBasics;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`step ${item.id === step ? 'step-current' : ''}`}
                  aria-current={item.id === step ? 'step' : undefined}
                  disabled={!open}
                  onClick={() => go(item.id)}
                >
                  <span className="step-number">{position + 1}</span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="save-state" aria-live="polite">{saveLabel}</p>
      </div>

      <div className="wizard-body">
        <section className="wizard-form">
          {step === 'basics' && (
            <div className="stack">
              <Field
                label="Website address"
                error={errors.startUrl}
                hint="The page your app opens first. It must use https://."
              >
                <form
                  className="url-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runCheck();
                  }}
                >
                  <input
                    type="text"
                    inputMode="url"
                    className="mono"
                    placeholder="https://example.com"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    aria-label="Website address"
                  />
                  <button className="button" disabled={checking || !urlInput.trim()}>
                    {checking ? 'Checking…' : 'Check website'}
                  </button>
                </form>
              </Field>

              {check && !checking && (
                <div className={`check ${passes(check) ? 'check-ok' : 'check-bad'}`} role="status">
                  {check.reachable ? (
                    <ul>
                      <li>{check.https ? 'Uses HTTPS' : 'Doesn’t use HTTPS. Apps need a secure https:// address, so this site can’t be used yet.'}</li>
                      <li>
                        {check.mobileReady === true
                          ? 'Set up for phones'
                          : check.mobileReady === false
                            ? 'Not set up for phones. It will work, but pages may look small.'
                            : 'Couldn’t tell whether it’s set up for phones'}
                      </li>
                      <li>{check.embeddable ? 'Can be previewed here' : 'Can’t be previewed here, but the app is unaffected'}</li>
                    </ul>
                  ) : (
                    <p>{failureText(check.failure)}</p>
                  )}
                </div>
              )}

              {draft.startUrl && (
                <>
                  <Field label="App name" error={errors.appName} hint="Shown under the icon on the phone.">
                    <input
                      type="text"
                      maxLength={50}
                      value={draft.appName ?? ''}
                      aria-invalid={Boolean(errors.appName)}
                      onChange={(event) => setField('appName', event.target.value || undefined)}
                      aria-label="App name"
                    />
                  </Field>
                  {offered?.appName && offered.appName !== draft.appName && (
                    <Offer onAccept={() => setField('appName', offered.appName)}>
                      Name on your site: <strong>{offered.appName}</strong>
                    </Offer>
                  )}

                  <Field
                    label="Package name"
                    error={errors.packageName}
                    hint={app.locked ? 'Locked after the first build, so updates install over the old app.' : 'Google Play’s unique id for your app. It can’t change after the first build.'}
                  >
                    <input
                      type="text"
                      className="mono"
                      value={draft.packageName ?? ''}
                      disabled={app.locked}
                      aria-invalid={Boolean(errors.packageName)}
                      onChange={(event) => setField('packageName', event.target.value.trim() || undefined)}
                      aria-label="Package name"
                    />
                  </Field>
                </>
              )}
            </div>
          )}

          {step === 'branding' && (
            <div className="stack">
              <Field label="Icon" error={iconError} hint="A square PNG, at least 512 × 512 and up to 5 MB.">
                <div className="icon-row">
                  {iconUrl ? <img src={iconUrl} alt="Current icon" className="icon-current" /> : <span className="icon-current icon-empty" aria-hidden="true" />}
                  <label className="button button-quiet">
                    {uploading ? 'Uploading…' : app.hasIcon ? 'Replace icon' : 'Upload icon'}
                    <input
                      type="file"
                      accept="image/png"
                      className="visually-hidden"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadIcon(file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </Field>
              {offered?.icon && (
                <Offer onAccept={async () => uploadIcon(await dataUrlToBlob(offered.icon!))}>
                  <img src={offered.icon} alt="" className="offer-icon" /> Icon found on your site
                </Offer>
              )}

              <Field label="Colour" error={errors['ui.statusBarColor']} hint="Used for the phone’s status bar, and behind a transparent icon.">
                <div className="colour-row">
                  <input
                    type="color"
                    value={draft.ui?.statusBarColor ?? '#0e7c66'}
                    onChange={(event) => setUi({ statusBarColor: event.target.value.toUpperCase() })}
                    aria-label="Pick a colour"
                  />
                  <input
                    type="text"
                    className="mono"
                    placeholder="#0E7C66"
                    value={draft.ui?.statusBarColor ?? ''}
                    aria-invalid={Boolean(errors['ui.statusBarColor'])}
                    onChange={(event) => setUi({ statusBarColor: event.target.value.trim().toUpperCase() || undefined })}
                    aria-label="Colour as hex"
                  />
                </div>
              </Field>
              {offered?.statusBarColor && offered.statusBarColor !== draft.ui?.statusBarColor && (
                <Offer onAccept={() => setUi({ statusBarColor: offered.statusBarColor })}>
                  Colour on your site: <span className="swatch" style={{ background: offered.statusBarColor }} /> <span className="mono">{offered.statusBarColor}</span>
                </Offer>
              )}
            </div>
          )}

          {step === 'behaviour' && (
            <div className="stack">
              <Toggle label="Loading bar" hint="A thin bar at the top while a page loads." checked={ui.progressBar} onChange={(value) => setUi({ progressBar: value })} />
              <Toggle label="Pull to refresh" hint="Pulling down at the top reloads the page." checked={ui.pullToRefresh} onChange={(value) => setUi({ pullToRefresh: value })} />
              <Toggle label="Ask before closing" hint="Back on the first page asks before leaving the app." checked={ui.exitDialog} onChange={(value) => setUi({ exitDialog: value })} />
              <Toggle label="Pinch to zoom" hint="Let people zoom pages with two fingers." checked={ui.zoom} onChange={(value) => setUi({ zoom: value })} />

              <Field label="Screen orientation">
                <select value={ui.orientation} onChange={(event) => setUi({ orientation: event.target.value as typeof ui.orientation })} aria-label="Screen orientation">
                  <option value="unspecified">Follow the phone</option>
                  <option value="portrait">Always portrait</option>
                  <option value="landscape">Always landscape</option>
                </select>
              </Field>

              <Field
                label="Sites that open inside the app"
                error={errors.internalHosts}
                hint={<>One host per line. Links to any other site open in the phone’s browser. Leave empty to use <span className="mono">{hostOf(draft.startUrl ?? '') || 'your site'}</span> only.</>}
              >
                <textarea
                  className="mono"
                  rows={4}
                  value={hostsText}
                  aria-invalid={Boolean(errors.internalHosts)}
                  aria-label="Sites that open inside the app"
                  onChange={(event) => {
                    setHostsText(event.target.value);
                    const hosts = event.target.value.split(/[\s,]+/).map((host) => host.trim().toLowerCase()).filter(Boolean);
                    setField('internalHosts', hosts.length ? hosts : undefined);
                  }}
                />
              </Field>
            </div>
          )}

          {step === 'review' && (
            <div className="stack">
              {app.ready && config ? (
                !app.takenDown && <BuildPanel appId={id} latest={app.latestBuild} emailVerified={Boolean(me?.emailVerified)} />
              ) : (
                <div className="check check-bad" role="status"><p>Still needed: {missingItems.join(', ') || 'valid values in the highlighted fields'}.</p></div>
              )}

              <dl className="summary">
                <dt>Website</dt><dd className="mono">{draft.startUrl ?? '—'}</dd>
                <dt>App name</dt><dd>{draft.appName ?? '—'}</dd>
                <dt>Package name</dt><dd className="mono">{draft.packageName ?? '—'}</dd>
                <dt>Opens inside the app</dt><dd className="mono">{(config?.internalHosts ?? draft.internalHosts ?? []).join(', ') || '—'}</dd>
              </dl>

              <section>
                <h2 className="section-title">Permissions the app asks for</h2>
                <ul className="permissions">
                  {(config ? permissionsFor(config) : []).map((permission) => (
                    <li key={permission}>
                      <span className="mono">{permission.replace('android.permission.', '')}</span>
                      {permission === 'android.permission.INTERNET' && <span className="field-hint">Opens your website. Android grants it without asking.</span>}
                    </li>
                  ))}
                </ul>
                {!config && <p className="field-hint">Shown once the app is complete.</p>}
              </section>
            </div>
          )}

          <div className="wizard-nav">
            {index > 0 && <button type="button" className="button button-quiet" onClick={() => go(STEPS[index - 1]!.id)}>Back</button>}
            {index < STEPS.length - 1 && (
              <button type="button" className="button" disabled={step === 'basics' && !canLeaveBasics} onClick={() => go(STEPS[index + 1]!.id)}>
                Next: {STEPS[index + 1]!.label}
              </button>
            )}
          </div>
        </section>

        <aside className="wizard-preview">
          <PhonePreview
            appName={draft.appName}
            colour={/^#[0-9A-F]{6}$/i.test(draft.ui?.statusBarColor ?? '') ? draft.ui?.statusBarColor : undefined}
            iconUrl={iconUrl}
            startUrl={draft.startUrl}
            embeddable={check?.reachable ? check.embeddable : undefined}
          />
        </aside>
      </div>
    </main>
  );
};
