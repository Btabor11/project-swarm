// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { liveDir, registerLiveRun, unregisterLiveRun, listLiveRuns, findWriterConflicts, boardSummary } from '../tools/board.mjs';

const execFileAsync = promisify(execFile);

async function tempDir(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-board-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return fs.realpath(dir); }
async function git(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout; }
async function initRepo(dir) { await git(dir, ['init']); await git(dir, ['checkout', '-b', 'main']); await git(dir, ['config', 'user.email', 'test@example.com']); await git(dir, ['config', 'user.name', 'Test']); }
async function commitAll(dir, message) { await git(dir, ['add', '-A']); await git(dir, ['commit', '-m', message]); }
// git worktree add creates the directory itself; a temp dir must be emptied to that same path first.
async function emptyPath(t) { const dir = await tempDir(t); await fs.rm(dir, { recursive: true, force: true }); return dir; }

function trackingIsAlive(result) { const fn = pid => { fn.calls.push(pid); return result; }; fn.calls = []; return fn; }

test('two worktrees of one git repo conflict on a shared file, and not on disjoint files', async t => {
  const root = await tempDir(t);
  await initRepo(root);
  await fs.writeFile(path.join(root, 'a.txt'), 'a');
  await commitAll(root, 'init');
  const worktree = await emptyPath(t);
  await git(root, ['worktree', 'add', '-b', 'feature', worktree]);
  const dir = await tempDir(t);
  await registerLiveRun({ runId: 'run-a', root, outputs: ['a.txt', 'shared.txt'], pid: 111, dir });
  await registerLiveRun({ runId: 'run-b', root: worktree, outputs: ['b.txt', 'shared.txt'], pid: 222, dir });
  const isAlive = trackingIsAlive(true);
  const sharedConflicts = await findWriterConflicts({ runId: 'run-c', root, outputs: ['shared.txt'], dir, isAlive });
  assert.deepEqual(sharedConflicts.map(c => c.runId).sort(), ['run-a', 'run-b']);
  assert.deepEqual(sharedConflicts.find(c => c.runId === 'run-b').files, ['shared.txt']);
  assert.deepEqual(isAlive.calls.sort(), [111, 222]);
  const disjointConflicts = await findWriterConflicts({ runId: 'run-c', root, outputs: ['only-c.txt'], dir, isAlive: trackingIsAlive(true) });
  assert.deepEqual(disjointConflicts, []);
});

test('different repos never conflict', async t => {
  const rootA = await tempDir(t); await initRepo(rootA);
  const rootB = await tempDir(t); await initRepo(rootB);
  const dir = await tempDir(t);
  await registerLiveRun({ runId: 'run-a', root: rootA, outputs: ['shared.txt'], pid: 111, dir });
  await registerLiveRun({ runId: 'run-b', root: rootB, outputs: ['shared.txt'], pid: 222, dir });
  const isAlive = trackingIsAlive(true);
  const conflicts = await findWriterConflicts({ runId: 'run-c', root: rootA, outputs: ['shared.txt'], dir, isAlive });
  assert.deepEqual(conflicts, [{ runId: 'run-a', root: rootA, files: ['shared.txt'] }]);
  assert.deepEqual(isAlive.calls.sort(), [111, 222]);
});

test('a stale pid is pruned from the registry', async t => {
  const root = await tempDir(t);
  const dir = await tempDir(t);
  await registerLiveRun({ runId: 'run-stale', root, outputs: ['x.txt'], pid: 999999, dir });
  const isAlive = trackingIsAlive(false);
  const runs = await listLiveRuns({ dir, isAlive });
  assert.deepEqual(runs, []);
  assert.deepEqual(isAlive.calls, [999999]);
  await assert.rejects(fs.access(path.join(dir, 'run-stale.json')));
});

test('SWARM_LIVE_DIR overrides the default live directory', () => {
  assert.equal(liveDir({ SWARM_LIVE_DIR: '/tmp/custom-live' }, '/home/x'), '/tmp/custom-live');
  assert.equal(liveDir({}, '/home/x'), path.join('/home/x', '.project-swarm', 'live'));
});

test('registerLiveRun writes atomically and leaves no temp file', async t => {
  const root = await tempDir(t);
  const dir = await tempDir(t);
  await registerLiveRun({ runId: 'run-atomic', root, outputs: ['x.txt'], pid: process.pid, dir });
  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['run-atomic.json']);
  const record = JSON.parse(await fs.readFile(path.join(dir, 'run-atomic.json'), 'utf8'));
  assert.equal(record.runId, 'run-atomic');
  assert.equal(record.root, root);
  assert.equal(record.pid, process.pid);
  await unregisterLiveRun('run-atomic', { dir });
  await assert.rejects(fs.access(path.join(dir, 'run-atomic.json')));
  await unregisterLiveRun('run-atomic', { dir }); // ENOENT on the second call is ignored, not thrown
});

test('boardSummary reads each run\'s state.json, defaulting to unknown/[] when missing', async t => {
  const root = await tempDir(t);
  const runId = 'run-with-state';
  await fs.mkdir(path.join(root, '.swarm/runs', runId), { recursive: true });
  const state = { status: 'complete', jobs: [{ id: 'job-a', status: 'complete', outputs: ['out.txt'], extra: 'dropped' }] };
  await fs.writeFile(path.join(root, '.swarm/runs', runId, 'state.json'), JSON.stringify(state));
  const rootNoState = await tempDir(t);
  const dir = await tempDir(t);
  await registerLiveRun({ runId, root, outputs: ['out.txt'], pid: 111, dir });
  await registerLiveRun({ runId: 'run-without-state', root: rootNoState, outputs: ['y.txt'], pid: 222, dir });
  const isAlive = trackingIsAlive(true);
  const summary = await boardSummary({ dir, isAlive });
  const withState = summary.runs.find(r => r.runId === runId);
  const withoutState = summary.runs.find(r => r.runId === 'run-without-state');
  assert.deepEqual(withState.jobs, [{ id: 'job-a', status: 'complete', outputs: ['out.txt'] }]);
  assert.equal(withState.status, 'complete');
  assert.equal(withoutState.status, 'unknown');
  assert.deepEqual(withoutState.jobs, []);
  assert.deepEqual(isAlive.calls.sort(), [111, 222]);
});

test('a run never conflicts with its own record', async t => {
  const root = await tempDir(t);
  await initRepo(root);
  await fs.writeFile(path.join(root, 'a.txt'), 'a');
  await commitAll(root, 'init');
  const dir = await tempDir(t);
  await registerLiveRun({ runId: 'run-self', root, outputs: ['a.txt'], dir });
  assert.deepEqual(await findWriterConflicts({ runId: 'run-self', root, outputs: ['a.txt'], dir, isAlive: () => true }), []);
  assert.equal((await findWriterConflicts({ runId: 'run-other', root, outputs: ['a.txt'], dir, isAlive: () => true })).length, 1);
});
