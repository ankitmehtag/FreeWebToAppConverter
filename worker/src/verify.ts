const MIN_APK_BYTES = 100 * 1024;
const MAX_APK_BYTES = 150 * 1024 * 1024;

export type ExpectedBuild = {
  packageName: string;
  versionCode: number;
  versionName: string;
  signerSha256: string;
};

const fact = (text: string, pattern: RegExp) => pattern.exec(text)?.[1];

/** Compares what `verify.sh` printed against what was asked for. Throws on any difference. */
export const checkBuild = (facts: string, bytes: number, expected: ExpectedBuild) => {
  if (bytes < MIN_APK_BYTES || bytes > MAX_APK_BYTES) throw new Error(`Unexpected APK size: ${bytes}`);
  if (fact(facts, /package: name='([^']+)'/) !== expected.packageName) throw new Error('Wrong package');
  if (fact(facts, /versionCode='(\d+)'/) !== String(expected.versionCode)) throw new Error('Wrong version code');
  if (fact(facts, /versionName='([^']+)'/) !== expected.versionName) throw new Error('Wrong version name');
  if (fact(facts, /SHA-256 digest: ([0-9a-f]{64})/) !== expected.signerSha256) throw new Error('Wrong signer');
};

/** Checks the bundle: it passed `bundletool validate`, and it carries the same signer as the key made for the app. */
export const checkBundle = (facts: string, bytes: number, signerSha256: string) => {
  if (bytes < MIN_APK_BYTES || bytes > MAX_APK_BYTES) throw new Error(`Unexpected bundle size: ${bytes}`);
  if (!/^AAB valid$/m.test(facts)) throw new Error('The bundle is not valid');
  const signer = /^AAB SHA256: ([0-9A-F:]{95})$/m.exec(facts)?.[1];
  if (!signer || signer.replaceAll(':', '').toLowerCase() !== signerSha256) throw new Error('Wrong bundle signer');
};
