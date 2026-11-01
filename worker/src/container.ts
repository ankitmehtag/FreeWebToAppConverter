import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const LOG_LINES = 200;
export const BUILD_LABEL = 'sitetoapk.build';

export type BuildMounts = { generatedDir: string; secretsDir: string; outputDir: string };

export type ContainerOptions = BuildMounts & {
  buildId: string;
  image: string;
  args: string[];
  entrypoint?: string;
};

export const containerName = (buildId: string) => `sitetoapk-build-${buildId}`;

/** Every flag here is part of the isolation promise, so none may depend on user input. */
export const containerArgs = ({ buildId, image, generatedDir, secretsDir, outputDir, args, entrypoint }: ContainerOptions) => [
  'run',
  '--rm',
  '--name', containerName(buildId),
  '--label', `${BUILD_LABEL}=${buildId}`,
  '--platform', 'linux/amd64',
  '--user', '1000:1000',
  '--network', 'none',
  '--read-only',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--cpus', '2',
  '--memory', '4g',
  '--memory-swap', '4g',
  '--pids-limit', '512',
  '--tmpfs', '/work:rw,exec,size=2g,uid=1000,gid=1000',
  '--tmpfs', '/tmp:rw,size=256m,uid=1000,gid=1000',
  '-v', `${generatedDir}:/generated:ro`,
  '-v', `${secretsDir}:/secrets:ro`,
  '-v', `${outputDir}:/output`,
  ...(entrypoint ? ['--entrypoint', entrypoint] : []),
  image,
  ...args,
];

export const removeContainer = async (name: string) => {
  await exec('docker', ['rm', '-f', name]).catch(() => undefined);
};

/** Runs one container with a fixed argv and no shell, killing it at the timeout. */
export const runContainer = (options: ContainerOptions & { timeoutMs: number }) =>
  new Promise<{ code: number | null; timedOut: boolean; log: string }>((resolve, reject) => {
    const name = containerName(options.buildId);
    const child = spawn('docker', containerArgs(options), { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let timedOut = false;

    const collect = (chunk: Buffer) => {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      lines.splice(0, Math.max(0, lines.length - LOG_LINES));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      void removeContainer(name);
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      await removeContainer(name);
      resolve({ code, timedOut, log: lines.join('\n') });
    });
  });

export const listBuildContainers = async () => {
  const { stdout } = await exec('docker', ['ps', '-aq', '--filter', `label=${BUILD_LABEL}`]);
  return stdout.split('\n').filter(Boolean);
};
