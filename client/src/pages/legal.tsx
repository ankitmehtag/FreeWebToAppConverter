import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { OPERATOR, SITE_NAME, usePageMeta } from '../site';

const UPDATED = '7 November 2026';

const Legal = ({ path, title, children }: { path: string; title: string; children: ReactNode }) => {
  usePageMeta(path);
  return (
    <main className="article legal">
      <h1>{title}</h1>
      <p className="draft-note" role="note">
        Draft, last updated {UPDATED}. This text is being reviewed before launch and may change.
      </p>
      {children}
    </main>
  );
};

const Mail = () => <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;

export const Terms = () => (
  <Legal path="/terms" title="Terms of Service">
    <h2>Who we are</h2>
    <p>
      {SITE_NAME} (“the service”, “we”) is run by {OPERATOR.name}, {OPERATOR.place}. You can reach us at <Mail />.
    </p>

    <h2>Accepting these terms</h2>
    <p>By creating an account or building an app, you accept these terms. If you don’t accept them, don’t use the service.</p>

    <h2>Your account</h2>
    <p>
      You must give a real email address and keep your password to yourself. You’re responsible for what happens under your
      account. You must be old enough to agree to these terms where you live.
    </p>

    <h2>Your apps and your content</h2>
    <p>
      You keep all rights to your website, name, icon and anything else you give us. You let us use them only to build, store and
      deliver your apps. You must have the right to use everything you put into an app, including the website it opens.
    </p>
    <p>
      Apps must follow the <Link to="/acceptable-use">Acceptable Use Policy</Link>. If an app breaks it, we may refuse to build it,
      delete its APKs, and stop its download and install links, without notice.
    </p>

    <h2>What the Free plan includes</h2>
    <p>
      Free builds are APK files signed with our shared key, limited to 3 a day, kept for 7 days, and show a small “Made with”
      watermark. We may change these limits, and we’ll show the current ones on the <Link to="/pricing">pricing page</Link>.
    </p>

    <h2>Premium and refunds</h2>
    <p>
      Premium is bought once for one app. You can ask for a full refund within 7 days of payment, as long as you haven’t
      downloaded the signing key or the app bundle for that app. After a refund the app goes back to the Free plan, its signing
      key can no longer be downloaded, and builds you already made stay available until they expire. To ask, write to the
      address on the contact page. Receipts are plain receipts, not tax invoices.
    </p>

    <h2>Google Play and other stores</h2>
    <p>
      Whether a store accepts your app is up to that store. We don’t promise that any app will be accepted, stay listed, or meet a
      store’s rules.
    </p>

    <h2>The service as it is</h2>
    <p>
      We work to keep the service running and your apps correct, but we provide it as it is, without promises that it will always
      be available or free of errors. As far as the law allows, we aren’t liable for indirect losses, or for losses caused by the
      website your app opens.
    </p>

    <h2>Ending</h2>
    <p>
      You can stop using the service at any time and ask us to delete your account at <Mail />. We may suspend or close an account
      that breaks these terms.
    </p>

    <h2>Changes and law</h2>
    <p>
      We’ll update this page when these terms change, and tell you by email about changes that matter. The laws of {OPERATOR.law}{' '}
      apply, and the courts of Gurugram, Haryana, have jurisdiction.
    </p>
  </Legal>
);

export const Privacy = () => (
  <Legal path="/privacy" title="Privacy Policy">
    <h2>Who is responsible</h2>
    <p>
      {OPERATOR.name}, {OPERATOR.place}, runs {SITE_NAME} and decides how your data is used. Contact: <Mail />.
    </p>

    <h2>What we store, and why</h2>
    <ul>
      <li>
        <strong>Your account:</strong> your email address, a one-way hash of your password (never the password itself), whether your
        email is confirmed, and if you sign in with Google, your Google account id. Used to let you sign in.
      </li>
      <li>
        <strong>Sign-in sessions:</strong> a session record and hashed sign-in tokens, kept for up to 30 days. Used to keep you
        signed in safely.
      </li>
      <li>
        <strong>Your apps:</strong> each app’s website address, name, package name, colours, settings and icon. Used to build your
        app.
      </li>
      <li>
        <strong>Builds:</strong> the settings each build used, its status and its log, with passwords and paths removed. The APK is
        kept for 7 days on the Free plan.
      </li>
      <li>
        <strong>Install links:</strong> a hash of each link, kept for 1 hour.
      </li>
      <li>
        <strong>Reports about apps:</strong> the reason, any details and email the reporter gives, and a keyed hash of their IP
        address so one person can’t report an app many times. We don’t store the IP address itself.
      </li>
      <li>
        <strong>Limits against abuse:</strong> counters keyed by IP address and email, kept for up to 15 minutes, to slow down
        password guessing and floods of requests.
      </li>
    </ul>
    <p>We don’t use analytics or advertising, and we don’t sell your data.</p>

    <h2>Cookies</h2>
    <p>
      We set only the cookies needed to keep you signed in and protect your account from forged requests. They’re strictly
      necessary, so we don’t ask for consent. We set no tracking cookies.
    </p>

    <h2>Who processes your data for us</h2>
    <ul>
      <li><strong>Cloudflare (R2):</strong> stores icons and APK files.</li>
      <li><strong>Resend:</strong> sends account emails, such as confirmation and password reset.</li>
      <li><strong>Google:</strong> signs you in if you choose Google sign-in, delivers push notifications (Firebase Cloud Messaging) for apps that turn them on, and, when we switch it on, checks app websites against its list of unsafe sites.</li>
      <li><strong>Our database and hosting providers:</strong> hold your account and app records and run the service.</li>
    </ul>
    <p>Some of these providers process data outside India.</p>

    <h2>The website in your app</h2>
    <p>
      Your app opens your website, which has its own privacy practices. We don’t see what people do inside your app.
    </p>
    <p>
      If you turn on push notifications, people who install your app are asked for permission, and Google’s Firebase
      service delivers your messages to their phones. We keep no list of their devices and send only what you write.
    </p>

    <h2>Your choices</h2>
    <p>
      You can see and change your apps while signed in. To get a copy of your data, correct it, or delete your account and
      everything in it, email <Mail /> from your account’s address. We’ll reply within 30 days.
    </p>

    <h2>Changes</h2>
    <p>We’ll update this page when our practices change, and tell you by email about changes that matter.</p>
  </Legal>
);

export const AcceptableUse = () => (
  <Legal path="/acceptable-use" title="Acceptable Use Policy">
    <p>These rules apply to every app built with {SITE_NAME}, and to the website it opens.</p>

    <h2>Not allowed</h2>
    <ul>
      <li>Phishing: pages that try to collect passwords, bank or card details, OTPs or personal data under false pretences.</li>
      <li>Malware, spyware or anything that harms phones, or downloads harmful files.</li>
      <li>Scams, fake offers, fake investment or loan schemes, and other fraud.</li>
      <li>Pretending to be another company, bank, government body or person in a way meant to deceive.</li>
      <li>Content that is illegal where it’s used, including child sexual abuse material, which we report to the authorities.</li>
      <li>Harassment, hate, or content that encourages violence.</li>
      <li>Apps that break the policies of the store you publish to, such as Google Play’s.</li>
      <li>Using the service to attack, overload or probe our systems or anyone else’s.</li>
    </ul>

    <h2>What we do</h2>
    <p>
      We can check websites against a list of unsafe sites, and we review reports. When an app breaks these rules, we may refuse to
      build it, delete its APKs, stop its download and install links, and close the account.
    </p>

    <h2>Reporting an app</h2>
    <p>
      Use “Report this app” on the app’s install page, or email <Mail /> with the app’s name and where you found it.
    </p>
  </Legal>
);
