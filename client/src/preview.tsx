import { useState } from 'react';

type PreviewProps = {
  appName?: string;
  colour?: string;
  iconUrl?: string;
  startUrl?: string;
  /** From the URL check: true, false, or undefined before the site has been checked. */
  embeddable?: boolean;
  /** What the screen says before there is a site to show. */
  emptyText?: string;
};

/** A dark or light status bar text colour, so the clock stays readable on the chosen colour. */
const textOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.6 ? '#10302e' : '#ffffff';
};

const Screen = ({ startUrl, embeddable, appName, iconUrl, emptyText }: PreviewProps) => {
  if (!startUrl || embeddable === undefined) {
    return <div className="phone-note">{emptyText ?? 'Check your website on the first step to see it here.'}</div>;
  }
  if (embeddable) {
    return (
      <iframe
        className="phone-site"
        src={startUrl}
        title={`Live preview of ${appName || 'your site'}`}
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
      />
    );
  }
  return <Blocked startUrl={startUrl} appName={appName} iconUrl={iconUrl} />;
};

/** A site that won't be framed is shown as a picture of itself. Only if that fails does the screen explain. */
const Blocked = ({ startUrl, appName, iconUrl }: Pick<PreviewProps, 'startUrl' | 'appName' | 'iconUrl'>) => {
  // Keyed by address, so a new site starts again instead of keeping the last site's failure.
  const [failed, setFailed] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  if (failed !== startUrl) {
    return (
      <>
        <img
          key={startUrl}
          className="phone-site phone-shot"
          src={`/url/screenshot?url=${encodeURIComponent(startUrl!)}`}
          alt={`Preview of ${appName || 'your site'}`}
          onLoad={() => setLoaded(startUrl)}
          onError={() => setFailed(startUrl)}
        />
        {loaded !== startUrl && <div className="phone-note phone-loading">Loading a preview of your site…</div>}
      </>
    );
  }
  return (
    <div className="phone-note phone-blocked">
      {iconUrl && <img src={iconUrl} alt="" className="phone-blocked-icon" />}
      <strong>{appName || 'Your app'}</strong>
      <p>We couldn’t draw a preview of your site here.</p>
      <p>The real app isn’t affected: it opens your site directly.</p>
    </div>
  );
};

/** The phone beside every step, with the launcher icon underneath as it will sit on a home screen. */
export const PhonePreview = (props: PreviewProps) => {
  const colour = props.colour ?? '#e7ecea';
  return (
    <figure className="preview" aria-label="Phone preview">
      <div className="phone">
        <div className="phone-status" style={{ background: colour, color: textOn(colour) }}>
          <span>9:41</span>
          <span aria-hidden="true">▾ ▴ ■</span>
        </div>
        <div className="phone-screen">
          <Screen {...props} />
        </div>
      </div>
      <figcaption className="launcher">
        {props.iconUrl ? (
          <img src={props.iconUrl} alt="" className="launcher-icon" />
        ) : (
          <span className="launcher-icon launcher-icon-empty" aria-hidden="true" />
        )}
        <span className="launcher-name" key={props.appName || 'none'}>{props.appName || 'App name'}</span>
      </figcaption>
    </figure>
  );
};
