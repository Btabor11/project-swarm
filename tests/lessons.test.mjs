// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runManifest, integrateRun, cancelRun, readState, validateManifest, validateProject, waitRun, inspectRun } from '../tools/swarm.mjs';
import { git } from '../tools/codex-adapter.mjs';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../tools/swarm.mjs', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-swarm-lessons-'));
  await fs.writeFile(path.join(root, 'input.txt'), 'original');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const job = (overrides = {}) => ({ id: 'writer', agent: 'claude', model: 'sonnet', prompt: 'Update the assigned file.', context: ['input.txt'], outputs: ['input.txt'], timeoutMs: 5000, ...overrides });
const manifest = jobs => ({ version: 1, concurrency: 2, jobs: jobs ?? [job()] });

function fake(script) {
  return (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';\n${script}`], options);
}
const done = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Worker complete'}));`;
const update = fake(`fs.writeFileSync('input.txt','updated'); ${done}`);

async function waitForJobStatus(root, id, status) {
  for (let i = 0; i < 100; i++) {
    try { const state = await readState(root, id); if (state.jobs[0]?.status === status) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// --- 1 & 2: wait, and inspect's worker notes/cost -------------------------------------------

test('wait returns immediately for an already-terminal run and reports per-job cost/notes', async t => {
  const root = await fixture(t);
  const notes = ['did the thing'];
  const script = `fs.writeFileSync('input.txt','updated');console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:${JSON.stringify(JSON.stringify({ files_changed: ['input.txt'], notes }))},total_cost_usd:0.5}));`;
  const state = await runManifest(root, manifest(), { spawnImpl: fake(script) });
  const report = await waitRun(root, state.id);
  assert.equal(report.runId, state.id);
  assert.equal(report.status, 'complete');
  assert.equal(report.costUsd, 0.5);
  assert.deepEqual(report.jobs, [{ id: 'writer', status: 'complete', costUsd: 0.5, notes: ['did the thing'] }]);
  assert.ok(report.durationMs >= 0);
});

test('wait polls saved status until a running job reaches a terminal status', async t => {
  const root = await fixture(t);
  const pending = runManifest(root, manifest([job({ timeoutMs: 5000 })]), { id: 'wait-poll', spawnImpl: fake(`setTimeout(()=>{fs.writeFileSync('input.txt','updated');${done}},150)`) });
  for (let i = 0; i < 100; i++) { try { await readState(root, 'wait-poll'); break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
  const report = await waitRun(root, 'wait-poll', { pollMs: 20 });
  assert.equal(report.status, 'complete');
  await pending;
});

test('wait exits 2 on --timeout expiry with status still running, and rejects an unknown run id', async t => {
  const root = await fixture(t);
  const pending = runManifest(root, manifest(), { id: 'cli-wait-timeout', spawnImpl: fake('setInterval(()=>{},1000)') });
  await waitForJobStatus(root, 'cli-wait-timeout', 'running');
  await assert.rejects(execFileAsync(process.execPath, [CLI, '--root', root, 'wait', 'cli-wait-timeout', '--timeout', '0.05']), error => {
    assert.equal(error.code, 2);
    assert.equal(JSON.parse(error.stdout).status, 'running');
    return true;
  });
  await cancelRun(root, 'cli-wait-timeout');
  await pending;
  await assert.rejects(execFileAsync(process.execPath, [CLI, '--root', root, 'wait', 'no-such-run']), error => {
    assert.equal(error.code, 1);
    return true;
  });
});

test('wait CLI exits 1 when the run failed and 0 with summed cost when it completed', async t => {
  const root = await fixture(t);
  const failed = await runManifest(root, manifest(), { spawnImpl: fake('process.exit(7)') });
  await assert.rejects(execFileAsync(process.execPath, [CLI, '--root', root, 'wait', failed.id]), error => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).status, 'failed');
    return true;
  });
  const complete = await runManifest(root, manifest(), { spawnImpl: fake(`fs.writeFileSync('input.txt','updated');console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'ok',total_cost_usd:0.25}));`) });
  const { stdout } = await execFileAsync(process.execPath, [CLI, '--root', root, 'wait', complete.id]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, 'complete');
  assert.equal(parsed.costUsd, 0.25);
  assert.equal(parsed.jobs[0].costUsd, 0.25);
});

test('inspect exposes a worker\'s parsed final JSON result and reported cost, capping notes at 20 items of 500 chars', async t => {
  const root = await fixture(t);
  const notes = Array.from({ length: 25 }, (_, i) => `note-${i}-`.repeat(100));
  const resultLine = JSON.stringify({ files_changed: ['input.txt'], notes });
  const script = `fs.writeFileSync('input.txt','updated');console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:${JSON.stringify(resultLine)},total_cost_usd:0.25}));`;
  const state = await runManifest(root, manifest(), { spawnImpl: fake(script) });
  const report = await inspectRun(root, state.id);
  assert.equal(report.jobs[0].costUsd, 0.25);
  assert.deepEqual(report.jobs[0].result.files_changed, ['input.txt']);
  assert.equal(report.jobs[0].result.notes.length, 20);
  for (const note of report.jobs[0].result.notes) assert.ok(note.length <= 500);
});

test('inspect reports a null result and null cost when no line parses as a JSON object', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: fake(`fs.writeFileSync('input.txt','updated');console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Just prose, no JSON here.'}));`) });
  const report = await inspectRun(root, state.id);
  assert.equal(report.jobs[0].result, null);
  assert.equal(report.jobs[0].costUsd, null);
});

test('inspect and wait pick the last line that parses as a JSON object, skipping trailing prose', async t => {
  const root = await fixture(t);
  const jsonLine = JSON.stringify({ files_changed: ['input.txt'], notes: ['keep me'] });
  const responseText = `${jsonLine}\ntrailing prose after the JSON line`;
  const script = `fs.writeFileSync('input.txt','updated');console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:${JSON.stringify(responseText)}}));`;
  const state = await runManifest(root, manifest(), { spawnImpl: fake(script) });
  const inspectReport = await inspectRun(root, state.id);
  assert.deepEqual(inspectReport.jobs[0].result.notes, ['keep me']);
  const waitReport = await waitRun(root, state.id);
  assert.deepEqual(waitReport.jobs[0].notes, ['keep me']);
});

// --- 3: validate refuses untracked/ignored codex context files -------------------------------

async function codexFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-lessons-codex-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ['init']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'tracked content');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
  await git(root, ['add', '.']);
  await git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  return root;
}
const codexJob = (overrides = {}) => ({ id: 'writer', agent: 'codex', model: 'test-model', prompt: 'Update the output.', context: ['tracked.txt'], outputs: [], timeoutMs: 5000, ...overrides });
const codexManifest = job => ({ version: 1, jobs: [job] });

test('validate refuses a codex job whose context file is untracked by git', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'untracked.txt'), 'not committed');
  await assert.rejects(validateProject(root, codexManifest(codexJob({ context: ['untracked.txt'] }))), /Job writer: codex context file untracked\.txt is not tracked by git \(codex sees HEAD only\)/);
});

test('validate refuses a codex job whose context file is git-ignored', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored content');
  await assert.rejects(validateProject(root, codexManifest(codexJob({ context: ['ignored.txt'] }))), /Job writer: codex context file ignored\.txt is not tracked by git/);
});

test('validate keeps a tracked but uncommitted codex context file as a warning, not a refusal', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'modified but still tracked');
  const report = await validateProject(root, codexManifest(codexJob()));
  assert.equal(report.status, 'valid');
  assert.deepEqual(report.warnings[0].files, ['tracked.txt']);
});

test('the codex tracked-file refusal never applies to a non-codex job', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'untracked.txt'), 'not committed');
  const claudeManifest = { version: 1, jobs: [{ id: 'reader', agent: 'claude', model: 'sonnet', prompt: 'Read it.', context: ['untracked.txt'], outputs: [], timeoutMs: 5000 }] };
  assert.equal((await validateProject(root, claudeManifest)).status, 'valid');
});

test('run refuses the same untracked codex context before dispatching any worker', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'untracked.txt'), 'not committed');
  const state = await runManifest(root, codexManifest(codexJob({ context: ['untracked.txt'] })), { platform: 'darwin', spawnImpl: () => assert.fail('must not spawn') });
  assert.equal(state.status, 'failed');
  assert.match(state.error, /is not tracked by git/);
});

test('validateProject accepts an injected exec, calling it with the expected git argv', async t => {
  const root = await codexFixture(t);
  await fs.writeFile(path.join(root, 'untracked.txt'), 'not committed');
  const calls = [];
  const fakeExec = async (cmd, args) => { calls.push([cmd, args]); return { stdout: '' }; };
  const report = await validateProject(root, codexManifest(codexJob({ context: ['untracked.txt'] })), { exec: fakeExec });
  assert.equal(report.status, 'valid');
  assert.deepEqual(calls[0], ['git', ['-C', root, 'ls-files', '--error-unmatch', '--', 'untracked.txt']]);
});

test('an injected exec that reports a file untracked drives the refusal even for a genuinely tracked file', async t => {
  const root = await codexFixture(t);
  const fakeExec = async () => { throw Object.assign(Error('not tracked'), { code: 1 }); };
  await assert.rejects(validateProject(root, codexManifest(codexJob()), { exec: fakeExec }), /Job writer: codex context file tracked\.txt is not tracked by git/);
});

// --- 4: mutation checks -----------------------------------------------------------------------

const mutantManifest = (mutants, mutantCheck) => ({ version: 1, jobs: [job()], ...(mutants !== undefined ? { mutants } : {}), ...(mutantCheck !== undefined ? { mutantCheck } : {}) });

test('validateManifest accepts a well-formed mutants/mutantCheck pair', () => {
  assert.doesNotThrow(() => validateManifest(mutantManifest([{ name: 'm1', file: 'src/a.js', find: 'x', replace: 'y' }], { argv: ['node', '-e', '1'] })));
});

test('validateManifest rejects malformed mutants entries', () => {
  assert.throws(() => validateManifest(mutantManifest(Array.from({ length: 33 }, (_, i) => ({ name: `m${i}`, file: 'a.js', find: 'x', replace: 'y' })))), /at most 32 mutants/);
  assert.throws(() => validateManifest(mutantManifest([{ name: 'm1', file: 'a.js', find: 'x', replace: 'y', extra: true }])), /Unknown mutant field/);
  assert.throws(() => validateManifest(mutantManifest([{ name: '', file: 'a.js', find: 'x', replace: 'y' }])), /Invalid or duplicate mutant name/);
  assert.throws(() => validateManifest(mutantManifest([{ name: 'dup', file: 'a.js', find: 'x', replace: 'y' }, { name: 'dup', file: 'b.js', find: 'x', replace: 'y' }])), /Invalid or duplicate mutant name/);
  for (const bad of ['../escape.js', '.git/config', '.swarm/x', '/tmp/escape']) assert.throws(() => validateManifest(mutantManifest([{ name: 'm1', file: bad, find: 'x', replace: 'y' }])), /path/i);
  assert.throws(() => validateManifest(mutantManifest([{ name: 'm1', file: 'a.js', find: '', replace: 'y' }])), /find must be a non-empty string/);
  assert.throws(() => validateManifest(mutantManifest([{ name: 'm1', file: 'a.js', find: 'x', replace: 7 }])), /replace must be a string/);
});

test('validateManifest rejects malformed mutantCheck', () => {
  assert.throws(() => validateManifest(mutantManifest(undefined, { argv: [] })), /mutantCheck argv must be a non-empty array/);
  assert.throws(() => validateManifest(mutantManifest(undefined, { argv: ['node'], timeoutMs: 10 })), /mutantCheck timeoutMs must be 1000/);
  assert.throws(() => validateManifest(mutantManifest(undefined, { argv: ['node'], extra: true })), /Unknown mutantCheck field/);
  assert.throws(() => validateManifest(mutantManifest(undefined, { argv: [1] })), /mutantCheck argv items must be strings/);
});

test('integrate --mutants applies, checks, and always restores a mutant, reporting killed on a failing check', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'flip', file: 'input.txt', find: 'updated', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', "process.exit(require('fs').readFileSync('input.txt','utf8')==='mutated'?1:0)"] } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants.length, 1);
  assert.equal(result.mutants[0].status, 'killed');
  assert.equal(result.mutants[0].exitCode, 1);
  assert.deepEqual(result.mutantsSummary, { killed: 1, survived: 0, errors: 0 });
  assert.equal(result.mutantsPassed, true);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated');
});

test('a mutant that a check cannot detect is reported survived and fails --require-checks', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'flip', file: 'input.txt', find: 'updated', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', 'process.exit(0)'] } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants[0].status, 'survived');
  assert.equal(result.mutantsSummary.survived, 1);
  assert.equal(result.mutantsPassed, false);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated');

  const secondPlan = { ...plan };
  const secondState = await runManifest(root, secondPlan, { spawnImpl: update, id: 'require-mutants' });
  await assert.rejects(execFileAsync(process.execPath, [CLI, '--root', root, 'integrate', secondState.id, '--mutants', '--require-checks']), error => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).mutantsPassed, false);
    return true;
  });
});

test('a mutant whose find text does not occur exactly once is an error and is never applied', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'bad', file: 'input.txt', find: 'zzz-not-present', replace: 'y' }], mutantCheck: { argv: [process.execPath, '-e', 'process.exit(0)'] } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants[0].status, 'error');
  assert.match(result.mutants[0].tail, /find matched 0 times/);
  assert.equal(result.mutants[0].exitCode, null);
  assert.equal(result.mutantsSummary.errors, 1);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated');
});

test('a mutant whose find text occurs twice is an error and check does not run', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'twice', file: 'input.txt', find: 'updated', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', 'process.exit(1)'] } };
  const state = await runManifest(root, plan, { spawnImpl: fake(`fs.writeFileSync('input.txt','updated updated'); ${done}`) });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants[0].status, 'error');
  assert.match(result.mutants[0].tail, /find matched 2 times/);
  assert.equal(result.mutants[0].exitCode, null);
  assert.equal(result.mutantsSummary.errors, 1);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated updated');
});

test('a mutation check timeout is reported as an error and still restores the original file', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'hang', file: 'input.txt', find: 'updated', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 1000 } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants[0].status, 'error');
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated');
});

test('integrate --mutants without a mutants field in the manifest is a clear error', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: update });
  await assert.rejects(integrateRun(root, state.id, { mutants: true }), /No mutants declared/);
});

test('integrate --mutants without mutantCheck declared is a clear error', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'flip', file: 'input.txt', find: 'updated', replace: 'mutated' }] };
  const state = await runManifest(root, plan, { spawnImpl: update });
  await assert.rejects(integrateRun(root, state.id, { mutants: true }), /No mutantCheck declared/);
});

test('mutants never execute during run, only during integrate --mutants', async t => {
  const root = await fixture(t);
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'flip', file: 'input.txt', find: 'original', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', '1'] } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  assert.equal(state.mutants, undefined);
  assert.equal(state.mutantsSummary, undefined);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'original');
  const proposed = await fs.readFile(path.join(root, '.swarm', 'workspaces', state.id, 'writer', 'input.txt'), 'utf8');
  assert.equal(proposed, 'updated');
});

test('integrate --mutants expands {root} inside a mutantCheck argv item to the run\'s absolute project root', async t => {
  const root = await fixture(t);
  const script = "require('fs').writeFileSync('root-received.txt',process.argv[1]);process.exit(1)";
  const plan = { version: 1, jobs: [job()], mutants: [{ name: 'flip', file: 'input.txt', find: 'updated', replace: 'mutated' }], mutantCheck: { argv: [process.execPath, '-e', script, 'PREFIX={root}/marker'] } };
  const state = await runManifest(root, plan, { spawnImpl: update });
  const result = await integrateRun(root, state.id, { mutants: true });
  assert.equal(result.mutants[0].status, 'killed');
  assert.equal(await fs.readFile(path.join(root, 'root-received.txt'), 'utf8'), `PREFIX=${await fs.realpath(root)}/marker`);
});
