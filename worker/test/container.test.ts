import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { containerArgs, listBuildContainers, runContainer, type BuildMounts } from '../src/container';

const image = process.env.BUILDER_IMAGE ?? 'sitetoapk-builder:dev';

const mounts = (): BuildMounts => {
  const root = mkdtempSync(join(tmpdir(), 'f04-mounts-'));
  const paths = { generatedDir: join(root, 'generated'), secretsDir: join(root, 'secrets'), outputDir: join(root, 'output') };
  for (const path of Object.values(paths)) mkdirSync(path, { mode: 0o777 });
  writeFileSync(join(paths.secretsDir, 'store.pass'), 'PROBE_SECRET');
  execFileSync('chmod', ['-R', 'a+rwX', root]);
  return paths;
};

const probe = async (script: string, timeoutMs = 60000) =>
  runContainer({ buildId: `probe-${Date.now()}`, image, ...mounts(), entrypoint: '/bin/sh', args: ['-c', script], timeoutMs });

describe('containerArgs', () => {
  const args = containerArgs({ buildId: 'b1', image, ...mounts(), args: ['-PversionCode=1'] });

  it('locks the container down', () => {
    const joined = args.join(' ');
    for (const flag of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 512', '--memory 4g', '--memory-swap 4g', '--cpus 2', '--rm', '--user 1000:1000']) {
      expect(joined).toContain(flag);
    }
  });

  it('never carries a password', () => {
    expect(args.join(' ')).not.toContain('PROBE_SECRET');
    expect(args).not.toContain('--env');
    expect(args).not.toContain('-e');
  });

  it('mounts inputs read-only and nothing else', () => {
    const volumes = args.flatMap((arg, index) => (args[index - 1] === '-v' ? [arg] : []));
    expect(volumes.filter((volume) => volume.endsWith(':ro'))).toHaveLength(2);
    expect(volumes).toHaveLength(3);
    expect(args.join(' ')).not.toContain('docker.sock');
  });
});

describe.sequential('AC4: inside the container', () => {
  it('is not root and cannot write to the root filesystem', async () => {
    const { log } = await probe('id -u; touch /opt/x 2>&1; touch /etc/x 2>&1; grep CapEff /proc/self/status');
    expect(log).toMatch(/^1000$/m);
    expect(log).toContain('Read-only file system');
    expect(log).toMatch(/CapEff:\s+0000000000000000/);
  });
});

describe.sequential('AC5: nothing is reachable', () => {
  it('has no route and no Docker socket', async () => {
    const script = `
      for target in host.docker.internal:6379 host.docker.internal:27017 host.docker.internal:3000 172.17.0.1:6379 1.1.1.1:443; do
        host=\${target%:*}; port=\${target#*:}
        (timeout 3 bash -c "echo > /dev/tcp/$host/$port") 2>/dev/null && echo "REACHED $target" || echo "blocked $target"
      done
      ls /var/run/docker.sock 2>&1 || true
      ip=$(cat /proc/net/route | wc -l); echo "routes $ip"`;
    const { log } = await probe(script);
    expect(log).not.toContain('REACHED');
    expect(log.match(/blocked /g)).toHaveLength(5);
    expect(log).toContain('No such file');
    expect(log).toContain('routes 1');
  });
});

describe.sequential('AC6: limits', () => {
  it('stops a process that eats memory', async () => {
    const { code } = await probe(`x=$(head -c 6G /dev/zero | tr '\\0' a); echo survived`);
    expect(code).toBe(137);
  });

  it('survives a fork bomb', async () => {
    const { log } = await probe('f() { f | f & }; f; sleep 8; echo done', 45000);
    expect(log).toMatch(/fork|Resource temporarily unavailable|done/);
    expect(execFileSync('docker', ['info', '--format', '{{.ServerVersion}}']).length).toBeGreaterThan(0);
  });
});

describe.sequential('AC7: mounts', () => {
  it('cannot change inputs, but can write output', async () => {
    const { log } = await probe('touch /generated/x 2>&1; touch /secrets/x 2>&1; touch /output/ok && echo WROTE');
    expect(log.match(/Read-only file system/g)).toHaveLength(2);
    expect(log).toContain('WROTE');
  });

  it('keeps the password out of docker inspect', async () => {
    const buildId = `inspect-${Date.now()}`;
    const running = runContainer({ buildId, image, ...mounts(), entrypoint: '/bin/sh', args: ['-c', 'sleep 6'], timeoutMs: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const [id] = await listBuildContainers();
    const inspected = execFileSync('docker', ['inspect', id!]).toString();
    await running;
    expect(inspected).not.toContain('PROBE_SECRET');
  });
});

describe.sequential('AC13: timeout', () => {
  it('kills a hung build and leaves no container', async () => {
    const started = Date.now();
    const result = await probe('sleep 300', 4000);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(30000);
    expect(await listBuildContainers()).toEqual([]);
  });
});
