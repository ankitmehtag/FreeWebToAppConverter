import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Collection } from 'mongodb';
import { ACTIVE_STATUSES, setStatus } from './builds';
import { BUILD_LABEL, containerName, removeContainer } from './container';

const exec = promisify(execFile);
const GRACE_MS = 2 * 60 * 1000;

type ReaperDeps = { builds: Collection; timeoutMs: number; workRoot: string };

const containerBuildIds = async () => {
  const { stdout } = await exec('docker', ['ps', '-a', '--filter', `label=${BUILD_LABEL}`, '--format', `{{.Label "${BUILD_LABEL}"}}`]);
  return stdout.split('\n').filter(Boolean);
};

const isLive = async ({ builds }: ReaperDeps, id: string) => {
  const build = await builds.findOne({ _id: id.replace(/-verify$/, '') as never });
  return Boolean(build && ['queued', ...ACTIVE_STATUSES].includes(build.status));
};

/** Fails stuck builds, then removes containers and files that no live build owns. */
export const reap = async (deps: ReaperDeps) => {
  const cutoff = new Date(Date.now() - deps.timeoutMs - GRACE_MS);
  const stuck = await deps.builds.find({ status: { $in: ACTIVE_STATUSES }, startedAt: { $lt: cutoff } }).toArray();
  for (const build of stuck) {
    await setStatus(deps.builds, build._id as unknown as string, 'failed', { error: 'Build stuck past its timeout' });
  }

  for (const id of await containerBuildIds()) {
    if (!(await isLive(deps, id))) await removeContainer(containerName(id));
  }

  const folders = await readdir(deps.workRoot).catch(() => [] as string[]);
  for (const id of folders) {
    if (!(await isLive(deps, id))) await rm(join(deps.workRoot, id), { recursive: true, force: true });
  }
};
