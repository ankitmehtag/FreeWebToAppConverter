// Looks for payment keys, secrets and card numbers. Usage: scan-secrets.ts <file or folder>...
// Prints file:line and the kind of match, never the match itself. Exits 1 when it finds anything.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Finding = { file: string; line: number; kind: string };

const PATTERNS: [string, RegExp][] = [
  ['Razorpay key', /rzp_(?:live|test)_[A-Za-z0-9]{8,}/],
  ['Stripe key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/],
  ['webhook secret', /whsec_[A-Za-z0-9]{16,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // A name that holds a secret, set to something. An empty value, as in .env.example, is fine.
  ['secret assignment', /\b(?:RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|KEYSTORE_MASTER_KEY)\s*[=:]\s*["']?[A-Za-z0-9+/_:-]{8,}/],
];

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1 && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
};

// 13 to 19 digits, whole or in groups of four, not inside a longer number, hash, id or version.
const CARD = /(?<![\w.:/-])(?:\d{4}[ -]){3}\d{1,7}(?![\w.-])|(?<![\w.:/-])\d{13,19}(?![\w.-])/g;

const looksLikeCard = (match: string) => {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits);
};

export const scanText = (text: string, file: string): Finding[] => {
  const found: Finding[] = [];
  text.split('\n').forEach((line, index) => {
    for (const [kind, pattern] of PATTERNS) if (pattern.test(line)) found.push({ file, line: index + 1, kind });
    for (const match of line.matchAll(CARD)) if (looksLikeCard(match[0])) found.push({ file, line: index + 1, kind: 'card number' });
  });
  return found;
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle']);
const SKIP_FILES = /(^|\/)(package-lock\.json|.*\.(png|jpg|jpeg|gif|webp|ico|jar|keystore|jks|p12|zip|woff2?|ttf|apk|aab))$/;

export const scanPaths = async (paths: string[]): Promise<Finding[]> => {
  const found: Finding[] = [];
  const visit = async (path: string) => {
    const info = await stat(path).catch(() => null);
    if (!info) return;
    if (info.isDirectory()) {
      for (const name of await readdir(path)) if (!SKIP_DIRS.has(name)) await visit(join(path, name));
      return;
    }
    if (SKIP_FILES.test(path) || info.size > 20 * 1024 * 1024) return;
    const buffer = await readFile(path);
    if (buffer.includes(0)) return;
    found.push(...scanText(buffer.toString('utf8'), path));
  };
  for (const path of paths) await visit(path);
  return found;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: scan-secrets.ts <file or folder>...');
    process.exit(1);
  }
  const findings = await scanPaths(paths);
  for (const { file, line, kind } of findings) console.log(`${file}:${line}: ${kind}`);
  console.log(findings.length ? `${findings.length} finding(s)` : 'Nothing found');
  process.exitCode = findings.length ? 1 : 0;
}
