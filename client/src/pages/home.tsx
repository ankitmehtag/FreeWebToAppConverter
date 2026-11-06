import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { PhonePreview } from '../preview';
import { useSession } from '../session';
import { usePageMeta } from '../site';
import { failureText, normaliseUrl, passes, pendingSite, type UrlCheck } from '../url-check';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const FEATURES = [
  { title: 'Your name, icon and colours', text: 'Upload a square PNG icon and pick a colour. We make every Android icon size, including the round and themed ones.' },
  { title: 'Works offline, politely', text: 'With no connection, your app shows a clear offline screen with a retry button instead of an error page.' },
  { title: 'Pull to refresh and a loading bar', text: 'Familiar app gestures you can switch on or off.' },
  { title: 'Uploads and downloads', text: 'Forms that ask for a photo or file open the phone’s picker, and downloads land in the phone’s Downloads.' },
  { title: 'Links behave', text: 'Your own pages stay inside the app. Other sites, phone numbers, email and maps open in the right app.' },
  { title: 'Safe by default', text: 'HTTPS only, no file access, and Google sign-in opens in a secure browser tab, as Google requires.' },
];

/** The checker: the quickest way to see whether a site is ready to become an app. */
const SiteChecker = ({ onChecked }: { onChecked: (url: string, check: UrlCheck) => void }) => {
  const { me } = useSession();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState<{ url: string; check: UrlCheck } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const url = normaliseUrl(input);
    if (!url || busy) return;
    setInput(url);
    setBusy(true);
    try {
      const check = await api<UrlCheck>('/url/check', { method: 'POST', body: { url } });
      setChecked({ url, check });
      onChecked(url, check);
    } catch (error) {
      setChecked({ url, check: { reachable: false, failure: error instanceof ApiError && error.status === 429 ? 'rate' : 'unreachable' } });
    } finally {
      setBusy(false);
    }
  };

  const makeApp = () => {
    pendingSite.set(checked!.url);
    navigate(me ? '/my-apps' : '/sign-up');
  };

  const check = checked?.check;
  return (
    <div className="checker">
      <form className="checker-form" onSubmit={submit}>
        <label htmlFor="site" className="visually-hidden">Your website’s address</label>
        <input
          id="site"
          type="text"
          inputMode="url"
          autoComplete="url"
          className="mono"
          placeholder="yourwebsite.com"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button className="button" disabled={busy || !input.trim()}>{busy ? 'Checking…' : 'Check my site'}</button>
      </form>
      {check && (
        <div className={`check ${passes(check) ? 'check-ok' : 'check-bad'}`} role="status" aria-live="polite">
          {check.reachable ? (
            <>
              <ul>
                <li>{check.https ? 'Uses HTTPS' : 'Doesn’t use HTTPS yet. Apps need a secure https:// address, so add HTTPS first.'}</li>
                <li>
                  {check.mobileReady === true
                    ? 'Set up for phones'
                    : check.mobileReady === false
                      ? 'Not set up for phones yet. It will work, but pages may look small.'
                      : 'Couldn’t tell whether it’s set up for phones'}
                </li>
              </ul>
              {passes(check) && (
                <button type="button" className="button" onClick={makeApp}>
                  Make {hostOf(checked.url) || 'it'} an app
                </button>
              )}
            </>
          ) : (
            <p>{failureText(check.failure)}</p>
          )}
        </div>
      )}
    </div>
  );
};

export const Home = () => {
  usePageMeta('/');
  const { me } = useSession();
  const [preview, setPreview] = useState<{ url: string; embeddable?: boolean; name: string } | null>(null);

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-text">
          <h1>Your website, as an Android app.</h1>
          <p className="lede">
            Paste your site’s address. Get a signed APK you can install on any Android phone today, with your own name, icon and
            colours. Free.
          </p>
          <SiteChecker
            onChecked={(url, check) =>
              setPreview(check.reachable && check.https ? { url, embeddable: check.embeddable, name: hostOf(url) } : null)
            }
          />
          {me && (
            <p className="field-hint">
              Signed in as {me.email}. <Link to="/my-apps">Go to your apps</Link>
            </p>
          )}
        </div>
        <div className="hero-phone">
          <PhonePreview
            appName={preview?.name}
            colour="#0E7C66"
            startUrl={preview?.url}
            embeddable={preview?.embeddable}
            emptyText="Check your site, and see it here as an app."
          />
        </div>
      </section>

      <section className="band" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="how">
          <li>
            <strong>Paste your site</strong>
            <span>We check it’s reachable, uses HTTPS and is set up for phones, and take its name, colour and icon if it has them.</span>
          </li>
          <li>
            <strong>Make it yours</strong>
            <span>Choose the app’s name, icon, colour and how it behaves, with a live phone preview beside you.</span>
          </li>
          <li>
            <strong>Install the APK</strong>
            <span>We build and sign it in about five minutes. Download it, or scan a QR code to install it on your phone.</span>
          </li>
        </ol>
      </section>

      <section className="band" aria-labelledby="features">
        <h2 id="features">What your app does</h2>
        <ul className="features">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <strong>{feature.title}</strong>
              <span>{feature.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="band play" aria-labelledby="play">
        <h2 id="play">Thinking of Google Play?</h2>
        <p>
          Google Play can reject an app that only shows a website, under its rules on minimum functionality. The Free APK is made to
          install directly on phones, not for the Play Store. Apps that do well on Play give people something the website alone
          doesn’t: an offline page, notifications, or features made for phones.
        </p>
        <Link to="/faq#google-play" className="small-link">What Google Play expects</Link>
      </section>

      <section className="band closing">
        <h2>Ready when your site is.</h2>
        <Link className="button" to={me ? '/my-apps' : '/sign-up'}>{me ? 'Go to your apps' : 'Create a free account'}</Link>
      </section>
    </main>
  );
};
