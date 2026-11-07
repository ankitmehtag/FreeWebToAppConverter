// The whole journey, as a stranger takes it: sign up on the site, build an app, and open it on an Android emulator.
// Needs the built site served (vite preview), the API with mail going to Mailpit, a worker, and a booted emulator.
// Usage: npm run journey -w client (JOURNEY_BUILD_WAIT_MS shortens the wait for a build)
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const BASE = process.env.JOURNEY_BASE ?? 'http://localhost:5173';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const SITE = process.env.JOURNEY_SITE ?? 'https://example.com';
const SITE_TEXT = process.env.JOURNEY_SITE_TEXT ?? 'documentation examples';
const BUILD_WAIT_MS = Number(process.env.JOURNEY_BUILD_WAIT_MS ?? 20 * 60 * 1000);
const ADB = join(process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), 'platform-tools', 'adb');
const OUT = new URL('./out/', import.meta.url).pathname;
const stamp = Date.now();
const email = `journey-${stamp}@example.com`;
const password = 'journey-test-password';
const packageName = `com.example.journey${stamp}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = async (...args) => (await exec(ADB, args, { maxBuffer: 20 * 1024 * 1024 })).stdout;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
let current = 'start';

/** Runs one named step. A failure stops the journey, names the step, and keeps what it saw. */
const step = async (name, work) => {
  current = name;
  const begun = Date.now();
  try {
    const note = await work();
    console.log(`PASS ${name}${note ? ` - ${note}` : ''} (${((Date.now() - begun) / 1000).toFixed(0)} s)`);
  } catch (error) {
    const slug = name.replace(/\W+/g, '-');
    await page.screenshot({ path: join(OUT, `${slug}.png`), fullPage: true }).catch(() => undefined);
    console.error(`FAIL ${name}: ${error.message}`);
    console.error(`Saved what the page showed to ${join(OUT, `${slug}.png`)}`);
    await browser.close();
    process.exit(1);
  }
};

const mailLink = async () => {
  for (let i = 0; i < 60; i += 1) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    if (found.messages?.length) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
      const link = /https?:\/\/\S+\/verify-email\?token=[\w-]+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await sleep(500);
  }
  throw new Error('no confirmation email in Mailpit');
};

let apkPath;
let sha;

await step('emulator ready', async () => {
  const devices = await adb('devices');
  if (!/\temulator-\d+\s+device/.test(devices) && !/\tdevice\b/.test(devices)) throw new Error('no emulator or device connected to adb');
  if ((await adb('shell', 'getprop', 'sys.boot_completed')).trim() !== '1') throw new Error('the emulator has not finished booting');
  return (await adb('shell', 'getprop', 'ro.product.model')).trim();
});

await step('sign up', async () => {
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
});

await step('confirm email', async () => {
  await page.goto((await mailLink()).replace(/^https?:\/\/[^/]+/, BASE));
  await page.getByRole('heading', { name: 'Email confirmed' }).waitFor();
});

await step('sign in', async () => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your apps' }).waitFor();
});

await step('create app', async () => {
  await page.getByRole('button', { name: /New app|Make your first app/ }).first().click();
  await page.waitForURL(/\/basics$/);
  await page.getByLabel('Website address').fill(SITE);
  await page.getByRole('button', { name: 'Check website' }).click();
  await page.getByText('Uses HTTPS').waitFor({ timeout: 30000 });
  await page.getByLabel('App name').fill('Journey App');
  await page.getByLabel('Package name').fill(packageName);
  await page.getByText('All changes saved').waitFor({ timeout: 10000 });
  return packageName;
});

await step('icon and colour', async () => {
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.waitForURL(/\/branding$/);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0e7c66"/><rect x="156" y="156" width="200" height="200" rx="40" fill="#f2b33d"/></svg>';
  const png = await page.evaluate(async (markup) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(markup)}`;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, svg);
  await page.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByAltText('Current icon').waitFor();
  await page.getByLabel('Colour as hex').fill('#0E7C66');
  await page.getByText('All changes saved').waitFor({ timeout: 10000 });
});

await step('start build', async () => {
  await page.goto(page.url().replace(/\/branding$/, '/review'));
  await page.getByRole('button', { name: 'Build app' }).click();
  await page.waitForURL(/\/builds\/[0-9a-f-]{36}$/);
});

await step('follow build', async () => {
  await page.getByRole('link', { name: 'Download APK' }).waitFor({ timeout: BUILD_WAIT_MS });
  const lines = (await page.getByLabel('Build log').textContent()).split('\n').filter(Boolean).length;
  return `${lines} log lines`;
});

await step('download and checksum', async () => {
  const shown = (await page.locator('.sha').textContent()).trim();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download APK' }).click()]);
  apkPath = join(OUT, 'journey.apk');
  await download.saveAs(apkPath);
  sha = createHash('sha256').update(await readFile(apkPath)).digest('hex');
  if (sha !== shown) throw new Error(`downloaded SHA-256 ${sha} doesn't match the page's ${shown}`);
  return sha.slice(0, 12);
});

await step('install on emulator', async () => {
  const output = await adb('install', '-r', apkPath);
  if (!output.includes('Success')) throw new Error(output.trim());
});

await step('open app', async () => {
  await adb('shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1');
});

await step('site loads in the app', async () => {
  let dump = '';
  for (let i = 0; i < 30; i += 1) {
    await sleep(2000);
    await adb('shell', 'uiautomator', 'dump', '/sdcard/journey.xml').catch(() => undefined);
    dump = await adb('shell', 'cat', '/sdcard/journey.xml').catch(() => '');
    // A freshly booted emulator can put a "System UI isn't responding" dialog over the app; wait it out.
    const wait = /text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(dump);
    if (wait && dump.includes("isn't responding")) {
      const [x1, y1, x2, y2] = wait.slice(1).map(Number);
      await adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
      continue;
    }
    if (dump.includes(SITE_TEXT) && dump.includes(packageName)) {
      await writeFile(join(OUT, 'app-screen.png'), Buffer.from(await adb('exec-out', 'screencap', '-p'), 'binary'));
      return `"${SITE_TEXT}" shown by ${packageName}`;
    }
  }
  await writeFile(join(OUT, 'app-ui.xml'), dump);
  throw new Error(`"${SITE_TEXT}" never appeared; the last UI dump is in ${join(OUT, 'app-ui.xml')}`);
});

await step('uninstall', async () => {
  const output = await adb('uninstall', packageName);
  if (!output.includes('Success')) throw new Error(output.trim());
});

await browser.close();
console.log('Journey passed');
