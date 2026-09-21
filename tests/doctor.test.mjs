import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readdirSync, statSync, fstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { captureCliDiagnostic, doctor } from '../tools/swarm.mjs';

const required = '--restricted --safe-mode --tools --permission-prompts --strict-mcp-config --mcp-config --no-session-persistence --no-chrome --output-format';
function locateCapture(fd) {
  const opened = fstatSync(fd);
  for (const name of readdirSync(os.tmpdir()).filter(name => name.startsWith('swarm-cli-diagnostic-'))) {
    const directory = path.join(os.tmpdir(), name);
    try {
      const candidate = statSync(path.join(directory, 'stdout'));
      if (candidate.ino === opened.ino && candidate.dev === opened.dev) return directory;
    } catch {}
  }
  assert.fail('capture descriptor must refer to a private diagnostic file');
}

test('file diagnostic preserves large help despite immediate CLI exit and cleans up', async () => {
  let directory;
  const result = await captureCliDiagnostic(process.execPath, ['-e', `process.stdout.write('x'.repeat(100000)+${JSON.stringify(required)});process.stderr.write('diagnostic');process.exit(0)`], {
    spawnImpl(command, args, options) {
      assert.equal(typeof options.stdio[1], 'number');
      assert.equal(typeof options.stdio[2], 'number');
      directory = locateCapture(options.stdio[1]);
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(fstatSync(options.stdio[1]).mode & 0o777, 0o600);
      return spawn(command, args, options);
    }
  });
  assert.equal(result.stdout.length, 100000 + required.length);
  for (const flag of required.split(' ')) assert.ok(result.stdout.includes(flag));
  assert.equal(result.stderr, 'diagnostic');
  await assert.rejects(fs.access(directory), { code: 'ENOENT' });
});

test('doctor still validates every required restriction with injected diagnostics', async () => {
  const result = await doctor({ exec: async (_command, args) => ({ stdout: args[0] === '--version' ? 'synthetic CLI' : required }) });
  assert.equal(result.status, 'compatible');
  assert.equal(result.liveVerified, false);
  await assert.rejects(doctor({ exec: async (_command, args) => ({ stdout: args[0] === '--version' ? 'synthetic CLI' : required.replace('--safe-mode', '') }) }), /lacks required flags: --safe-mode/);
});

test('diagnostic failure, timeout and output overflow reject and remove temporary files', async () => {
  const scenarios = [
    { script: 'process.exit(7)', timeout: 10000, error: /CLI diagnostic exited 7/ },
    { script: 'setInterval(()=>{},1000)', timeout: 250, error: /CLI diagnostic timed out/ },
    { script: "process.stdout.write('x'.repeat(2*1024*1024));process.exit(0)", timeout: 10000, error: /CLI diagnostic (exited|output reached 512 KiB limit)/ }
  ];
  for (const { script, timeout, error } of scenarios) {
    let directory;
    await assert.rejects(captureCliDiagnostic(process.execPath, ['-e', script], {
      timeout,
      spawnImpl(command, args, options) {
        directory = locateCapture(options.stdio[1]);
        return spawn(command, args, options);
      }
    }), error);
    await assert.rejects(fs.access(directory), { code: 'ENOENT' });
  }
});
