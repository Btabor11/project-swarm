// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
// Runner-side wiring for CONTRACT.md sections 3-4: manifest schema, claude argv shape, and
// inspect/wait surfacing box.jsonl. box-mcp.mjs's own behavior is covered by box-mcp.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runManifest, validateManifest, claudeArgs, inspectRun, waitRun, resolveBoxBase } from '../tools/swarm.mjs';
import { git } from '../tools/codex-adapter.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-swarm-box-test-'));
  await fs.writeFile(path.join(root, 'input.txt'), 'original');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

// A fixture that is also a real git repo, so boxBase ref resolution has a HEAD to resolve.
async function gitFixture(t) {
  const root = await fs.realpath(await fixture(t));
  await git(root, ['init']);
  await git(root, ['add', 'input.txt']);
  await git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  return root;
}

const job = (overrides = {}) => ({ id: 'writer', agent: 'claude', model: 'sonnet', prompt: 'Update the assigned file.', context: ['input.txt'], outputs: ['input.txt'], timeoutMs: 5000, ...overrides });
const manifest = (jobs, boxChecks) => ({ version: 1, concurrency: 2, jobs: jobs ?? [job()], ...(boxChecks ? { boxChecks } : {}) });
const LINT = { argv: ['npm', 'test'] };

function fake(script) {
  return (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';\n${script}`], options);
}
const done = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Worker complete'}));`;
const update = fake(`fs.writeFileSync('input.txt','updated'); ${done}`);

// --- validation refusals -----------------------------------------------------------------

test('boxChecks: invalid top-level shapes are refused', () => {
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: [] }), /boxChecks must be an object/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: {} }), /1-10 named checks/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { 'bad name!': LINT } }), /Invalid boxCheck name/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { lint: { argv: ['npm'], extra: 1 } } }), /Unknown boxCheck field/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { lint: { argv: [] } } }), /boxCheck argv must be a non-empty array/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { lint: { argv: ['npm'], cwd: '/abs' } } }), /Invalid boxCheck cwd/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { lint: { argv: ['npm'], cwd: '../x' } } }), /Unsafe boxCheck cwd/);
  assert.throws(() => validateManifest({ ...manifest(), boxChecks: { lint: { argv: ['npm'], timeoutMs: 10 } } }), /Invalid boxCheck timeoutMs/);
});

test('boxChecks: a job may only name checks declared at the top level', () => {
  assert.throws(() => validateManifest(manifest([job({ boxChecks: ['lint'] })])), /requires top-level manifest\.boxChecks/);
  assert.throws(() => validateManifest(manifest([job({ boxChecks: ['nope'] })], { lint: LINT })), /unknown boxCheck: nope/);
  assert.doesNotThrow(() => validateManifest(manifest([job({ boxChecks: ['lint'] })], { lint: LINT })));
});

test('boxChecks: rejects unknown-agent jobs, empty/duplicate names, and unknown fields', () => {
  assert.throws(() => validateManifest(manifest([job({ agent: 'openai', model: 'gpt-4o', boxChecks: ['lint'] })], { lint: LINT })), /boxChecks is only supported for the claude agent/);
  assert.throws(() => validateManifest(manifest([job({ boxChecks: [] })], { lint: LINT })), /non-empty array/);
  assert.throws(() => validateManifest(manifest([job({ boxChecks: ['lint', 'lint'] })], { lint: LINT })), /duplicate boxChecks name/);
  assert.throws(() => validateManifest(manifest([job({ boxChecks: ['lint'], extraField: 1 })], { lint: LINT })), /Unknown job field/);
});

test('boxCheckMaxCalls requires boxChecks and must be a sane positive integer', () => {
  assert.throws(() => validateManifest(manifest([job({ boxCheckMaxCalls: 10 })])), /boxCheckMaxCalls requires boxChecks/);
  const withMax = value => manifest([job({ boxChecks: ['lint'], boxCheckMaxCalls: value })], { lint: LINT });
  assert.throws(() => validateManifest(withMax(0)), /invalid boxCheckMaxCalls/);
  assert.throws(() => validateManifest(withMax(1.5)), /invalid boxCheckMaxCalls/);
  assert.throws(() => validateManifest(withMax(100001)), /invalid boxCheckMaxCalls/);
  assert.doesNotThrow(() => validateManifest(withMax(5)));
});

// --- claude argv shape -------------------------------------------------------------------

test('claudeArgs: mcp-config stays empty and no --allowedTools is added without boxChecks (unchanged behavior)', () => {
  const args = claudeArgs(job({ model: undefined }));
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.equal(args.includes('--allowedTools'), false);
});

test('claudeArgs: with boxChecks, --mcp-config names only the box server and --allowedTools grants run_check', () => {
  const boxMcp = { serverPath: '/install/tools/box-mcp.mjs', argv: ['run1', 'writer', '/ws', '/checks.json', '30'], cwd: '/project' };
  const args = claudeArgs(job({ model: undefined }), boxMcp);
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['box']);
  assert.deepEqual(config.mcpServers.box, { command: process.execPath, args: ['/install/tools/box-mcp.mjs', 'run1', 'writer', '/ws', '/checks.json', '30'], cwd: '/project' });
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__box__run_check');
  assert.ok(args.includes('--strict-mcp-config'));
});

test('claudeArgs: a web job with boxChecks allows both WebSearch/WebFetch and run_check', () => {
  const boxMcp = { serverPath: '/install/tools/box-mcp.mjs', argv: ['run1', 'writer', '/ws', '/checks.json', '30'], cwd: '/project' };
  const args = claudeArgs(job({ model: undefined, web: true, outputs: [] }), boxMcp);
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'WebSearch,WebFetch,mcp__box__run_check');
});

test('runManifest for a claude job with boxChecks writes the run-dir checks file and passes it to the box server', async t => {
  const root = await fixture(t);
  let capturedArgs;
  const spawnImpl = (command, args, options) => {
    if (command === 'claude') capturedArgs = args;
    return update(command, args, options);
  };
  const state = await runManifest(root, manifest([job({ boxChecks: ['lint'] })], { lint: LINT }), { spawnImpl });
  assert.equal(state.status, 'complete');

  const config = JSON.parse(capturedArgs[capturedArgs.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['box']);
  assert.equal(config.mcpServers.box.command, process.execPath);
  assert.match(config.mcpServers.box.args[0], /box-mcp\.mjs$/);
  const [, runId, jobId, workspaceDir, checksFile] = config.mcpServers.box.args;
  assert.equal(runId, state.id);
  assert.equal(jobId, 'writer');
  assert.equal(workspaceDir, path.join(root, '.swarm/workspaces', state.id, 'writer'));
  assert.equal(config.mcpServers.box.cwd, root);

  assert.deepEqual(JSON.parse(await fs.readFile(checksFile, 'utf8')), { lint: LINT });
  assert.match(await fs.readFile(path.join(root, '.swarm/runs', state.id, 'writer/message.txt'), 'utf8'), /run_check: lint/);
});

// --- inspect/wait read box.jsonl -----------------------------------------------------------

test('inspectRun and waitRun read box.jsonl for call counts, last result per check, and an unavailable warning', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest([job({ boxChecks: ['lint'] })], { lint: LINT }), { spawnImpl: update });
  assert.equal(state.status, 'complete');

  const lines = [
    { ts: '2026-01-01T00:00:00.000Z', call: 1, check: 'lint', exitCode: 1, seconds: 0.4, stdoutTail: '', stderrTail: 'fail' },
    { ts: '2026-01-01T00:00:01.000Z', call: 2, check: 'lint', unavailable: true, reason: 'box down' },
  ];
  const boxJsonlPath = path.join(root, '.swarm/runs', state.id, 'writer', 'box.jsonl');
  await fs.writeFile(boxJsonlPath, lines.map(line => JSON.stringify(line)).join('\n') + '\n');

  const inspected = await inspectRun(root, state.id);
  assert.equal(inspected.jobs[0].boxCalls, 2);
  assert.deepEqual(inspected.jobs[0].lastBoxResults.lint, lines[1]);
  assert.ok(inspected.warnings.includes('box check unavailable: writer'));

  const waited = await waitRun(root, state.id);
  assert.equal(waited.jobs[0].boxCalls, 2);
  assert.deepEqual(waited.jobs[0].lastBoxResults.lint, lines[1]);
  assert.ok(waited.warnings.includes('box check unavailable: writer'));
});

test('inspectRun and waitRun leave a job without boxChecks exactly as before: no box fields, no box warning', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: update });
  const inspected = await inspectRun(root, state.id);
  assert.equal('boxCalls' in inspected.jobs[0], false);
  assert.equal('lastBoxResults' in inspected.jobs[0], false);
  assert.deepEqual(inspected.warnings, []);
  const waited = await waitRun(root, state.id);
  assert.equal('boxCalls' in waited.jobs[0], false);
  assert.deepEqual(waited.warnings, []);
});

// --- boxBase validation --------------------------------------------------------------------

test('boxBase: refused as an unknown field when there are no boxChecks anywhere', () => {
  assert.throws(() => validateManifest({ ...manifest(), boxBase: { repo: 'cluer-helm' } }), /Unknown manifest field: boxBase/);
});

test('boxBase: valid once boxChecks exists at the top level, even unreferenced by any job', () => {
  assert.doesNotThrow(() => validateManifest({ ...manifest(undefined, { lint: LINT }), boxBase: { repo: 'cluer-helm' } }));
  assert.doesNotThrow(() => validateManifest({ ...manifest([job({ boxChecks: ['lint'] })], { lint: LINT }), boxBase: { repo: 'cluer-helm' } }));
});

test('boxBase: validates shape and the repo pattern', () => {
  const withBoxChecks = boxBase => ({ ...manifest(undefined, { lint: LINT }), boxBase });
  assert.throws(() => validateManifest(withBoxChecks([])), /boxBase must be an object/);
  assert.throws(() => validateManifest(withBoxChecks({ repo: 'cluer-helm', extra: 1 })), /Unknown boxBase field: extra/);
  assert.throws(() => validateManifest(withBoxChecks({ repo: 'Cluer-Helm' })), /Invalid boxBase\.repo/);
  assert.throws(() => validateManifest(withBoxChecks({ repo: '.hidden' })), /Invalid boxBase\.repo/);
  assert.throws(() => validateManifest(withBoxChecks({ repo: 'a'.repeat(65) })), /Invalid boxBase\.repo/);
  assert.throws(() => validateManifest(withBoxChecks({})), /Invalid boxBase\.repo/);
  assert.doesNotThrow(() => validateManifest(withBoxChecks({ repo: 'cluer-helm' })));
  assert.doesNotThrow(() => validateManifest(withBoxChecks({ repo: 'a' })));
});

// --- boxBase ref resolution ------------------------------------------------------------------

test('resolveBoxBase: null without boxBase, and refuses a non-git project root', async t => {
  const root = await fixture(t);
  assert.equal(await resolveBoxBase(root, manifest()), null);
  await assert.rejects(() => resolveBoxBase(root, { boxBase: { repo: 'cluer-helm' } }), /requires a git repository/);
});

test('resolveBoxBase: resolves to the project root\'s full HEAD sha in a temp git repo', async t => {
  const root = await gitFixture(t);
  const expected = (await git(root, ['rev-parse', 'HEAD'])).trim();
  assert.match(expected, /^[0-9a-f]{40}$/);
  const resolved = await resolveBoxBase(root, { boxBase: { repo: 'cluer-helm' } });
  assert.deepEqual(resolved, { repo: 'cluer-helm', ref: expected });
});

test('runManifest records the resolved boxBase ref in the run status and passes it to box-mcp.mjs', async t => {
  const root = await gitFixture(t);
  const expected = (await git(root, ['rev-parse', 'HEAD'])).trim();
  let capturedArgs;
  const spawnImpl = (command, args, options) => {
    if (command === 'claude') capturedArgs = args;
    return update(command, args, options);
  };
  const state = await runManifest(root, { ...manifest([job({ boxChecks: ['lint'] })], { lint: LINT }), boxBase: { repo: 'cluer-helm' } }, { spawnImpl });
  assert.equal(state.status, 'complete');
  assert.deepEqual(state.boxBase, { repo: 'cluer-helm', ref: expected });

  const config = JSON.parse(capturedArgs[capturedArgs.indexOf('--mcp-config') + 1]);
  const [, , , , , , baseArg] = config.mcpServers.box.args;
  assert.deepEqual(JSON.parse(baseArg), { repo: 'cluer-helm', ref: expected });
});

test('runManifest leaves boxBase null without a manifest boxBase', async t => {
  const root = await gitFixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: update });
  assert.equal(state.boxBase, null);
});
