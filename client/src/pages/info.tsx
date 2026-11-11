import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { OPERATOR, usePageMeta } from '../site';

const Article = ({ path, title, children }: { path: string; title: string; children: ReactNode }) => {
  usePageMeta(path);
  return (
    <main className="article">
      <h1>{title}</h1>
      {children}
    </main>
  );
};

export const Pricing = () => {
  usePageMeta('/pricing');
  return (
    <main className="article pricing-page">
      <h1>Pricing</h1>
      <p className="lede">Start free. Premium, for Google Play, is on its way.</p>
      <div className="plans">
        <section className="plan" aria-labelledby="free">
          <h2 id="free">Free</h2>
          <p className="plan-price">₹0</p>
          <ul>
            <li>A signed APK that installs on any Android phone</li>
            <li>Your name, icon, colours and app behaviour</li>
            <li>3 builds a day</li>
            <li>Download links kept for 7 days</li>
            <li>Install on a phone by scanning a QR code</li>
            <li>A small “Made with” watermark in the app</li>
          </ul>
          <Link className="button" to="/sign-up">Create a free account</Link>
        </section>
        <section className="plan plan-soon" aria-labelledby="premium">
          <h2 id="premium">Premium</h2>
          <p className="plan-price">₹99 <span className="field-hint">or $1, per app, one time. Coming soon.</span></p>
          <ul>
            <li>Everything in Free</li>
            <li>An Android App Bundle (AAB) ready for Google Play</li>
            <li>Your own signing key, kept for your app’s updates</li>
            <li>No watermark</li>
          </ul>
          
        </section>
      </div>
    </main>
  );
};

const QUESTIONS: { id: string; question: string; answer: ReactNode }[] = [
  {
    id: 'what',
    question: 'What does it make?',
    answer: 'An Android app that opens your website full screen, with your name, icon and colours. You get a signed APK file that installs on Android phones.',
  },
  {
    id: 'site',
    question: 'What does my site need?',
    answer: 'It must be public and use HTTPS. It works best when it’s set up for phones, which the checker on the home page tells you.',
  },
  {
    id: 'iphone',
    question: 'Does it make iPhone apps?',
    answer: 'Not yet. Only Android for now.',
  },
  {
    id: 'google-play',
    question: 'Can I put the app on Google Play?',
    answer: (
      <>
        The Free APK is for installing directly on phones. Google Play needs an Android App Bundle signed with your own key, which
        Premium will make. Even then, Google can reject an app that only shows a website, under its rules on minimum functionality.
        Apps that pass give people more than the website alone: an offline page, notifications, or features made for phones.
      </>
    ),
  },
  {
    id: 'updates',
    question: 'How do I update my app?',
    answer: 'Your app shows your live website, so changes to your site appear straight away. Build again only to change the name, icon, colour or behaviour.',
  },
  {
    id: 'limits',
    question: 'How many builds can I make?',
    answer: '3 a day on the Free plan. A build that fails because of a problem on our side doesn’t count.',
  },
  {
    id: 'warning',
    question: 'Why does Android warn me when I install it?',
    answer: 'Android warns about any app installed from outside Google Play. Allow your browser to install unknown apps when asked, and only install apps you made or trust.',
  },
  {
    id: 'rules',
    question: 'What can’t I build?',
    answer: (
      <>
        Anything that tricks or harms people, such as phishing, malware or scams. Read the <Link to="/acceptable-use">Acceptable Use Policy</Link>.
      </>
    ),
  },
  {
    id: 'report',
    question: 'How do I report a harmful app?',
    answer: 'Use “Report this app” on its install page, or email us. We take down apps that break our rules.',
  },
];

export const Faq = () => (
  <Article path="/faq" title="Questions and answers">
    <dl className="faq">
      {QUESTIONS.map((item) => (
        <div key={item.id} id={item.id}>
          <dt>{item.question}</dt>
          <dd>{item.answer}</dd>
        </div>
      ))}
    </dl>
  </Article>
);

export const About = () => (
  <Article path="/about" title="About">
    <p>
      Free Website to App Converter turns a website into an Android app without writing code. It’s made for small businesses,
      schools, creators and anyone whose website already does the job, and who wants it on their customers’ phones.
    </p>
    <p>
      It’s run by {OPERATOR.name}, in {OPERATOR.place}. Every app is built in its own locked-down container, signed, and checked
      before you get it.
    </p>
  </Article>
);

export const Contact = () => (
  <Article path="/contact" title="Contact">
    <p>
      Email <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> about your account, an app, or anything on this site.
    </p>
    <p>
      To report a harmful app, use “Report this app” on its install page, or email us with the app’s name and where you found it.
    </p>
  </Article>
);
