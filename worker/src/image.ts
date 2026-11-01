import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const VERSION_FILE = new URL('../../android-template/version.json', import.meta.url);

export const templateVersionSha = async () =>
  createHash('sha256').update(await readFile(VERSION_FILE)).digest('hex');

/** Refuses a builder image made from a different template version. */
export const assertImageMatches = async (image: string, expected?: string) => {
  const wanted = expected ?? (await templateVersionSha());
  const { stdout } = await exec('docker', [
    'image', 'inspect', image, '--format', '{{index .Config.Labels "sitetoapk.version-sha"}}',
  ]);
  if (stdout.trim() !== wanted) throw new Error(`Builder image ${image} does not match version.json`);
};
