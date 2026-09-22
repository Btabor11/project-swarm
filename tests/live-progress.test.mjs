// SPDX-License-Identifier: Apache-2.0
// Content-free live activity telemetry: byte counts and timestamps, never worker output text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runManifest, readState, cancelRun, summarizeRun, activityRecorder } from '../tools/swarm.mjs';

const PROGRESS_KEYS = ['observable', 'stdoutBytes', 'stderrBytes', 'firstOutputAt', 'lastOutputAt', 'lastActivityAt', 'sampledAt'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-live-progress-'));
  await fs.writeFile(path.join(root, 'input.txt'), 'original');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function waitFor(check, attempts = 300, delay = 20) {
  for (let index = 0; index < attempts; index++) {
    let value;
    try { value = await check(); } catch {}
    if (value) return value;
    await sleep(delay);
  }
  throw new Error('Condition was never observed');
}

const job = (overrides = {}) => ({ id: 'writer', agent: 'claude', model: 'test-model', prompt: 'Work on the copied file.', context: ['input.txt'], outputs: [], timeoutMs: 20000, ...overrides });
const manifest = jobs => ({ version: 1, concurrency: 2, jobs });
// Only tests inject a provider; production still spawns the literal CLI command.
const fake = script => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';\n${script}`], options);
const emit = text => `process.stdout.write(${JSON.stringify(text)});`;
const hang = 'setInterval(()=>{},1000);';
const line = event => `${JSON.stringify(event)}\n`;
const chatter = line({ type: 'system', subtype: 'init', model: 'test-model' });

test('live state separates a working CLI from a silent one before either worker finishes', async t => {
  const root = await fixture(t);
  const pending = runManifest(root, manifest([job({ id: 'talker' }), job({ id: 'silent' })]), {
    id: 'live-telemetry', progressIntervalMs: 60,
    spawnImpl: (command, args, options) => (options.cwd.endsWith('talker') ? fake(emit(chatter) + hang) : fake(hang))(command, args, options)
  });
  const live = await waitFor(async () => {
    const state = await readState(root, 'live-telemetry');
    return state.jobs.every(entry => entry.status === 'running') && state.jobs[0].progress?.stdoutBytes > 0 ? state : null;
  });
  const [talker, silent] = live.jobs;
  assert.equal(talker.status, 'running');
  assert.equal(talker.progress.observable, true);
  assert.equal(talker.progress.stdoutBytes, Buffer.byteLength(chatter));
  assert.ok(talker.progress.firstOutputAt && talker.progress.lastOutputAt && talker.progress.lastActivityAt);
  assert.equal(silent.status, 'running');
  assert.equal(silent.progress.stdoutBytes, 0);
  assert.equal(silent.progress.firstOutputAt, null);
  assert.equal(silent.progress.lastActivityAt, null);
  // monitor is summarizeRun over the saved state, so the same snapshot reaches operators.
  const report = summarizeRun(live);
  assert.equal(report.jobs[0].progress.stdoutBytes, talker.progress.stdoutBytes);
  assert.ok(report.jobs[1].progress.silentMs >= report.jobs[0].progress.silentMs);
  assert.ok(live.summary.jobs[0].progress.stdoutBytes > 0);

  await cancelRun(root, 'live-telemetry');
  const state = await pending;
  assert.equal(state.status, 'cancelled');
  assert.equal(state.jobs[0].progress.stdoutBytes, Buffer.byteLength(chatter));
  assert.equal(state.jobs[1].progress.stdoutBytes, 0);
  assert.equal(state.jobs[1].progress.firstOutputAt, null);
});

test('telemetry counts exact UTF-8 bytes per stream and stores no output text', async t => {
  const root = await fixture(t);
  const marker = 'MARKER-6f2a-worker-prose';
  const payload = line({ type: 'result', subtype: 'success', is_error: false, result: `héllo 😀 — ${marker}` });
  const noise = `warn ✅ ${marker}\n`;
  const state = await runManifest(root, manifest([job()]), { progressIntervalMs: 60, spawnImpl: fake(`${emit(payload)}process.stderr.write(${JSON.stringify(noise)});`) });
  const progress = state.jobs[0].progress;
  assert.equal(state.jobs[0].status, 'complete');
  assert.ok(Buffer.byteLength(payload) > payload.length, 'fixture must contain multi-byte characters');
  assert.equal(progress.stdoutBytes, Buffer.byteLength(payload));
  assert.equal(progress.stderrBytes, Buffer.byteLength(noise));
  assert.ok(progress.firstOutputAt <= progress.lastOutputAt);
  assert.equal(progress.lastActivityAt, progress.lastOutputAt);
  assert.deepEqual(Object.keys(progress).sort(), [...PROGRESS_KEYS].sort());
  for (const value of Object.values(progress)) assert.ok(value === null || ['number', 'string', 'boolean'].includes(typeof value), 'telemetry holds scalars only');
  // Transcripts keep the prose; run metadata never does.
  assert.ok(!JSON.stringify(state).includes(marker));
  assert.ok(!(await fs.readFile(path.join(root, '.swarm/runs', state.id, 'state.json'), 'utf8')).includes(marker));
  assert.ok((await fs.readFile(path.join(root, '.swarm/runs', state.id, 'writer/provider.jsonl'), 'utf8')).includes(marker));
});

test('a worker that writes nothing keeps null timestamps instead of a fabricated heartbeat', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest([job()]), { progressIntervalMs: 60, spawnImpl: fake('') });
  const progress = state.jobs[0].progress;
  assert.equal(state.jobs[0].status, 'failed');
  assert.equal(progress.observable, true);
  assert.equal(progress.stdoutBytes, 0);
  assert.equal(progress.stderrBytes, 0);
  assert.equal(progress.firstOutputAt, null);
  assert.equal(progress.lastOutputAt, null);
  assert.equal(progress.lastActivityAt, null);
  assert.equal(typeof progress.sampledAt, 'string');
  // Silence is measured from the start, so it is never reported as recent activity.
  const reported = summarizeRun(state).jobs[0].progress;
  assert.ok(Number.isFinite(reported.silentMs) && reported.silentMs >= 0);
});

test('API jobs report telemetry as unavailable rather than inventing observed activity', async t => {
  const root = await fixture(t);
  const body = { done: true, model: 'test-model', message: { content: JSON.stringify({ summary: 'Reviewed supplied text.', files: [] }) } };
  const state = await runManifest(root, manifest([job({ agent: 'ollama', model: 'test-model' })]), {
    progressIntervalMs: 60,
    spawnImpl: () => { throw new Error('API jobs must not spawn a process'); },
    fetchImpl: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  const progress = state.jobs[0].progress;
  assert.equal(state.jobs[0].status, 'complete');
  assert.equal(progress.observable, false);
  assert.match(progress.reason, /not observable/);
  for (const key of ['stdoutBytes', 'stderrBytes', 'firstOutputAt', 'lastOutputAt', 'lastActivityAt', 'sampledAt']) assert.equal(progress[key], null, key);
  assert.equal(summarizeRun(state).jobs[0].progress.silentMs, null);
});

test('cancelled and failed runs keep their counters and write no state after returning', async t => {
  const root = await fixture(t);
  for (const scenario of ['cancelled', 'failed']) {
    const id = `settle-${scenario}`;
    const script = emit(chatter) + (scenario === 'cancelled' ? hang : 'setTimeout(()=>process.exit(7),40);');
    const pending = runManifest(root, manifest([job()]), { id, progressIntervalMs: 60, spawnImpl: fake(script) });
    if (scenario === 'cancelled') {
      await waitFor(async () => (await readState(root, id)).jobs[0].progress?.stdoutBytes > 0);
      await cancelRun(root, id);
    }
    const state = await pending;
    assert.equal(state.jobs[0].status, scenario);
    assert.equal(state.jobs[0].progress.stdoutBytes, Buffer.byteLength(chatter));
    assert.ok(state.jobs[0].progress.firstOutputAt);
    // The shared throttle timer must be stopped: no write may follow the terminal record.
    const file = path.join(root, '.swarm/runs', id, 'state.json');
    const before = await fs.readFile(file, 'utf8'), stamp = (await fs.stat(file)).mtimeMs;
    await sleep(400);
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.equal((await fs.stat(file)).mtimeMs, stamp);
    assert.equal(JSON.parse(before).jobs[0].status, scenario);
  }
});

test('summary tolerates state saved before telemetry existed', () => {
  const at = ms => new Date(ms).toISOString();
  const state = { id: 'legacy', status: 'running', startedAt: at(1000), concurrency: 2, peakConcurrency: 2, jobs: [
    { id: 'legacy-job', agent: 'claude', status: 'complete', startedAt: at(1000), finishedAt: at(1500), durationMs: 500, usage: { input_tokens: 7 } },
    { id: 'api-job', agent: 'openai', status: 'running', startedAt: at(1200), progress: { observable: false, reason: 'unavailable', stdoutBytes: null, stderrBytes: null, firstOutputAt: null, lastOutputAt: null, lastActivityAt: null, sampledAt: null } },
    { id: 'talking', agent: 'claude', status: 'running', startedAt: at(1000), progress: { observable: true, stdoutBytes: 12, stderrBytes: 0, firstOutputAt: at(1100), lastOutputAt: at(1200), lastActivityAt: at(1200), sampledAt: at(1900) } },
    { id: 'stuck', agent: 'claude', status: 'running', startedAt: at(1000), progress: { observable: true, stdoutBytes: 0, stderrBytes: 0, firstOutputAt: null, lastOutputAt: null, lastActivityAt: null, sampledAt: at(1900) } }
  ] };
  const report = summarizeRun(state, 2000);
  assert.equal(report.jobs[0].progress, null);
  assert.equal(report.jobs[0].durationMs, 500);
  assert.deepEqual(report.usageByProvider.claude, { input_tokens: 7 });
  assert.equal(report.jobs[1].progress.observable, false);
  assert.equal(report.jobs[1].progress.silentMs, null);
  assert.equal(report.jobs[2].progress.stdoutBytes, 12);
  assert.equal(report.jobs[2].progress.silentMs, 800);
  assert.equal(report.jobs[3].progress.silentMs, 1000);
  assert.deepEqual(report.counts, { queued: 0, running: 3, complete: 1, failed: 0, timeout: 0, cancelled: 0 });
});

test('telemetry writes are throttled and stop with the last observed job', async () => {
  let flushes = 0;
  const recorder = activityRecorder(() => flushes++, 50);
  const record = {};
  const tracker = recorder.observe(record);
  assert.equal(record.progress.stdoutBytes, 0);
  assert.equal(record.progress.firstOutputAt, null);
  for (let index = 0; index < 200; index++) tracker.onOutput('stdout', 3);
  tracker.onOutput('stderr', 5);
  await sleep(180);
  const throttled = flushes;
  assert.ok(throttled >= 1 && throttled <= 5, `expected coalesced writes, saw ${throttled}`);
  assert.equal(record.progress.stdoutBytes, 600);
  assert.equal(record.progress.stderrBytes, 5);
  tracker.stop();
  tracker.onOutput('stdout', 99); // A settled job records nothing further.
  await sleep(200);
  assert.equal(flushes, throttled);
  assert.equal(record.progress.stdoutBytes, 600);
});


test('rejected asynchronous telemetry flush stops recording and remains observable to its owner', async () => {
  const failure = new Error('Injected progress disk failure');
  let flushes = 0, notified = null;
  const recorder = activityRecorder(async () => { flushes++; throw failure; }, 20, error => { notified = error; });
  const record = {}, tracker = recorder.observe(record);
  tracker.onOutput('stdout', 7);
  await waitFor(() => notified);
  assert.equal(notified, failure);
  await assert.rejects(recorder.settle(), error => error === failure);
  tracker.onOutput('stdout', 17);
  await sleep(80);
  assert.equal(flushes, 1);
  assert.equal(record.progress.stdoutBytes, 7);
});

test('a failing live state save cancels owned workers and records the actual coordinator failure', async t => {
  const root = await fixture(t);
  let injected = false;
  const children = [];
  const state = await runManifest(root, manifest([job({ id: 'one' }), job({ id: 'two' })]), {
    id: 'failed-progress', progressIntervalMs: 50,
    spawnImpl: (...args) => { const child = fake(emit(chatter) + hang)(...args); children.push(child); return child; },
    onState(snapshot) {
      if (!injected && snapshot.status === 'running' && snapshot.jobs.every(entry => entry.progress?.stdoutBytes > 0)) {
        injected = true;
        throw new Error('Injected live artifact save failure');
      }
    }
  });
  assert.equal(injected, true);
  assert.equal(state.status, 'failed');
  assert.equal(state.error, 'Injected live artifact save failure');
  assert.equal(children.length, 2);
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'every spawned worker has terminated');
  assert.ok(state.jobs.every(entry => !['running', 'queued'].includes(entry.status)));
  const file = path.join(root, '.swarm/runs/failed-progress/state.json');
  const final = await fs.readFile(file, 'utf8'), stamp = (await fs.stat(file)).mtimeMs;
  assert.equal(JSON.parse(final).error, state.error);
  await sleep(180);
  assert.equal(await fs.readFile(file, 'utf8'), final);
  assert.equal((await fs.stat(file)).mtimeMs, stamp);
});

for (const scenario of ['start-save', 'message-write']) {
  test(`failure before provider launch (${scenario}) fails cleanly without starting a worker`, async t => {
    const root = await fixture(t);
    const id = `failed-${scenario}`;
    let injected = false, spawned = 0;
    const state = await runManifest(root, manifest([job()]), {
      id, progressIntervalMs: 50,
      spawnImpl: () => { spawned++; throw new Error('Unexpected provider launch'); },
      onState(snapshot) {
        if (!injected && snapshot.jobs[0]?.status === 'running') {
          injected = true;
          if (scenario === 'start-save') throw new Error('Injected starting state save failure');
          // A directory cannot be atomically replaced by the requested transcript file.
          mkdirSync(path.join(root, '.swarm/runs', id, 'writer/message.txt'), { recursive: true });
        }
      }
    });
    assert.equal(injected, true);
    assert.equal(spawned, 0);
    assert.equal(state.status, 'failed');
    assert.equal(state.jobs[0].status, 'failed');
    assert.match(state.error, scenario === 'start-save' ? /Injected starting state save failure/ : /EISDIR|EPERM/);
    const file = path.join(root, '.swarm/runs', id, 'state.json');
    const stamp = (await fs.stat(file)).mtimeMs;
    await sleep(130);
    assert.equal((await fs.stat(file)).mtimeMs, stamp);
  });
}

test('failed atomic state rename removes its temporary artifact and preserves the target',async t=>{
 const root=await fixture(t),directory=path.join(root,'.swarm/runs/rename-failure');
 await fs.mkdir(path.join(directory,'state.json'),{recursive:true});
 await fs.writeFile(path.join(directory,'state.json/keep.txt'),'existing content');
 await assert.rejects(runManifest(root,manifest([job()]),{
  id:'rename-failure',spawnImpl:()=>{throw new Error('A failed initial state save must not launch a provider');}
 }),/EISDIR|ENOTDIR|EPERM/);
 assert.deepEqual((await fs.readdir(directory)).sort(),['claim','manifest.json','state.json']);
 assert.equal(await fs.readFile(path.join(directory,'state.json/keep.txt'),'utf8'),'existing content');
});
