import type { ReactNode } from 'react';
import { ADS_DEFAULT_GAP_SECONDS, ADS_MIN_GAP_SECONDS, isTestAdsId, type Draft } from '@sitetoapk/shared';

type Ads = NonNullable<Draft['ads']>;
type Props = {
  premium: boolean;
  ads: Draft['ads'];
  errors: Record<string, string>;
  onChange: (ads: Ads | undefined) => void;
  onUpgrade: () => void;
};

const Row = ({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) => (
  <div className="field">
    <span className="field-label">{label}</span>
    {children}
    {error ? <span className="field-error" role="alert">{error}</span> : hint && <span className="field-hint">{hint}</span>}
  </div>
);

/** The Monetization step: the owner's own AdMob IDs, where banners go and how often interstitials show. */
export const AdsPanel = ({ premium, ads, errors, onChange, onUpgrade }: Props) => {
  if (!premium) {
    return (
      <div className="stack">
        <div className="check" role="status">
          <p>Ads are a Premium feature. With Premium you paste your own Google AdMob IDs and the app shows your banner and interstitial ads, so the earnings go to your AdMob account.</p>
        </div>
        <button type="button" className="button" onClick={onUpgrade}>See Premium</button>
      </div>
    );
  }

  const on = Boolean(ads?.enabled);
  const set = (change: Partial<Ads>) => onChange({ enabled: on, ...ads, ...change });
  const text = (key: 'appId' | 'bannerUnitId' | 'interstitialUnitId') => (event: { target: { value: string } }) => set({ [key]: event.target.value.trim() || undefined });
  const testing = [ads?.appId, ads?.bannerUnitId, ads?.interstitialUnitId].some(isTestAdsId);

  return (
    <div className="stack">
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(event) => set({ enabled: event.target.checked })} />
        <span className="toggle-text">
          <span className="toggle-label">Show ads in this app</span>
          <span className="field-hint">Needs a new build after you change it. Uses your own Google AdMob account.</span>
        </span>
      </label>

      {on && (
        <>
          <Row label="AdMob app ID" error={errors['ads.appId']} hint="From AdMob, Apps, App settings. Looks like ca-app-pub-1234567890123456~1234567890.">
            <input className="mono" value={ads?.appId ?? ''} onChange={text('appId')} aria-invalid={Boolean(errors['ads.appId'])} aria-label="AdMob app ID" />
          </Row>
          <Row label="Banner ad unit ID (optional)" error={errors['ads.bannerUnitId']} hint="Looks like ca-app-pub-1234567890123456/1234567890. Needs the same publisher number as the app ID.">
            <input className="mono" value={ads?.bannerUnitId ?? ''} onChange={text('bannerUnitId')} aria-invalid={Boolean(errors['ads.bannerUnitId'])} aria-label="Banner ad unit ID" />
          </Row>
          <Row label="Interstitial ad unit ID (optional)" error={errors['ads.interstitialUnitId']} hint="A full-screen ad that shows after a page change. Add a banner, an interstitial, or both.">
            <input className="mono" value={ads?.interstitialUnitId ?? ''} onChange={text('interstitialUnitId')} aria-invalid={Boolean(errors['ads.interstitialUnitId'])} aria-label="Interstitial ad unit ID" />
          </Row>
          <Row label="Banner position">
            <select value={ads?.bannerPosition ?? 'bottom'} onChange={(event) => set({ bannerPosition: event.target.value as 'top' | 'bottom' })} aria-label="Banner position">
              <option value="bottom">At the bottom</option>
              <option value="top">At the top</option>
            </select>
          </Row>
          <Row label="Time between full-screen ads (seconds)" error={errors['ads.interstitialGapSeconds']} hint={`At least ${ADS_MIN_GAP_SECONDS}. Never on launch, and never more often than this.`}>
            <input
              type="number"
              min={ADS_MIN_GAP_SECONDS}
              max={3600}
              value={ads?.interstitialGapSeconds ?? ADS_DEFAULT_GAP_SECONDS}
              onChange={(event) => set({ interstitialGapSeconds: event.target.value ? Number(event.target.value) : undefined })}
              aria-label="Seconds between full-screen ads"
            />
          </Row>
          <label className="toggle">
            <input type="checkbox" checked={Boolean(ads?.childDirected)} onChange={(event) => set({ childDirected: event.target.checked })} />
            <span className="toggle-text">
              <span className="toggle-label">This app is directed to children</span>
              <span className="field-hint">Turns on Google’s child-directed and under-age treatment, which limits ad personalisation.</span>
            </span>
          </label>

          {testing && (
            <div className="check check-bad" role="status">
              <p>You are using Google’s test IDs. The app shows test ads and earns nothing until you use your own IDs.</p>
            </div>
          )}
          <div className="check" role="status">
            <p>
              Visitors in the EEA and the UK see Google’s consent form before any ad. Make your consent message in AdMob (Privacy & messaging) first. Without one the app still runs, but Google may limit the ads it serves there.
              When you publish on Google Play, declare that the app contains ads and uses the advertising ID.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
