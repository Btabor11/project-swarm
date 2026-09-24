import test from 'node:test';
import assert from 'node:assert/strict';
import { go, commitOutputs, goExitCode } from '../tools/go.mjs';

const flags = (overrides = {}) => ({ commitMessage: undefined, repo: undefined, payloadPath: undefined, requireSections: [], mutants: false, mergeMethod: undefined, timeoutMs: undefined, ...overrides });

// Records the order and arguments of every stage call so tests can assert both sequencing and
// exactly what each stage was given, without any real CLI, git, or GitHub involved.
function makeDeps(overrides = {}) {
  const calls = [];
  const stubs = {
    run: async () => ({ id: 'run-1' }),
    wait: async () => ({ status: 'complete', costUsd: 1.5, warnings: [] }),
    integrate: async () => ({ status: 'integrated', files: ['a.txt'], checks: [], checksPassed: true }),
    commit: async () => ({ status: 'committed' }),
    ship: async () => ({ status: 'ready' }),
    ...overrides,
  };
  // Every stage, stub or override, is recorded, so an override never hides a call from `calls`.
  const deps = Object.fromEntries(Object.entries(stubs).map(([name, impl]) => [name, async (...args) => { calls.push([name, ...args]); return impl(...args); }]));
  return { deps, calls };
}
const stages = calls => calls.map(call => call[0]);

test('go: a manifest path runs run, wait, integrate, commit, ship in order', async () => {
  const { deps, calls } = makeDeps();
  const result = await go('/root', 'manifest.json', flags({ commitMessage: 'msg', repo: 'acme/widgets', payloadPath: 'pr.json' }), deps);
  assert.deepEqual(stages(calls), ['run', 'wait', 'integrate', 'commit', 'ship']);
  assert.equal(result.runId, 'run-1');
  assert.equal(result.status, 'ready');
  assert.equal(result.stage, 'ship');
});

test('go: a run id skips the run stage entirely', async () => {
  const { deps, calls } = makeDeps();
  const result = await go('/root', 'run-existing-1', flags(), deps);
  assert.deepEqual(stages(calls), ['integrate']);
  assert.equal(result.runId, 'run-existing-1');
  assert.equal(result.status, 'integrated');
  assert.equal(result.stage, 'integrate');
});

test('go: a manifest run that never completes fails at the run stage before integrate', async () => {
  const { deps, calls } = makeDeps({ wait: async () => ({ status: 'failed', costUsd: 0.2, warnings: ['model mismatch: x'] }) });
  const result = await go('/root', 'manifest.json', flags(), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'run');
  assert.match(result.reason, /run failed/);
  assert.equal(result.cost, 0.2);
  assert.deepEqual(result.warnings, ['model mismatch: x']);
  assert.deepEqual(stages(calls), ['run', 'wait']);
});

test('go: stops at integrate when checks fail, naming the stage, the failing checks, and never reaching commit/ship', async () => {
  const { deps, calls } = makeDeps({
    integrate: async () => ({ status: 'integrated', files: ['a.txt'], checksPassed: false, checks: [{ name: 'lint', status: 'failed' }, { name: 'unit', status: 'passed' }] }),
  });
  const result = await go('/root', 'run-1', flags({ commitMessage: 'msg', repo: 'acme/x', payloadPath: 'pr.json' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'integrate');
  assert.match(result.reason, /lint/);
  assert.doesNotMatch(result.reason, /unit/);
  assert.deepEqual(stages(calls), ['integrate']);
});

test('go: a surviving/errored mutant with --mutants also stops at integrate', async () => {
  const { deps, calls } = makeDeps({
    integrate: async () => ({ status: 'integrated', files: ['a.txt'], checksPassed: true, checks: [], mutantsPassed: false, mutantsSummary: { killed: 0, survived: 1, errors: 0 } }),
  });
  const result = await go('/root', 'run-1', flags({ mutants: true, commitMessage: 'msg' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'integrate');
  assert.deepEqual(stages(calls), ['integrate']);
});

test('go: a surviving mutant from the manifest stops at integrate even without --mutants', async () => {
  const { deps, calls } = makeDeps({
    integrate: async () => ({ status: 'integrated', files: ['a.txt'], checksPassed: true, checks: [], mutantsPassed: false, mutantsSummary: { killed: 0, survived: 1, errors: 0 } }),
  });
  const result = await go('/root', 'run-1', flags({ commitMessage: 'msg', repo: 'acme/x', payloadPath: 'pr.json' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'integrate');
  assert.deepEqual(stages(calls), ['integrate']);
});

test('go: an integrate stage that throws becomes a failed result naming the integrate stage', async () => {
  const { deps } = makeDeps({ integrate: async () => { throw new Error('Only a complete run from this repository can be integrated'); } });
  const result = await go('/root', 'run-1', flags(), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'integrate');
  assert.match(result.reason, /complete run/);
});

test('go: with no --commit-message, commit is skipped and a dirty tree is reported as a failure at ship', async () => {
  const { deps, calls } = makeDeps({ ship: async () => ({ status: 'refused', reason: 'commit first' }) });
  const result = await go('/root', 'run-1', flags({ repo: 'acme/x', payloadPath: 'pr.json' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'ship');
  assert.equal(result.reason, 'commit first');
  assert.deepEqual(stages(calls), ['integrate', 'ship']);
});

test('go: the commit stage receives exactly the integrate stage\'s file list, never a wildcard', async () => {
  const { deps, calls } = makeDeps({
    integrate: async () => ({ status: 'integrated', files: ['x.txt', 'y.txt'], checksPassed: true, checks: [] }),
  });
  const result = await go('/root', 'run-1', flags({ commitMessage: 'exact message' }), deps);
  const commitCall = calls.find(call => call[0] === 'commit');
  assert.deepEqual(commitCall[2], ['x.txt', 'y.txt']);
  assert.ok(!commitCall[2].includes('-A'));
  assert.equal(commitCall[3], 'exact message');
  assert.equal(result.status, 'committed');
  assert.equal(result.stage, 'commit');
});

test('go: a failing commit stage stops before ship', async () => {
  const { deps, calls } = makeDeps({ commit: async () => ({ status: 'failed', reason: 'git commit failed: nothing to commit' }) });
  const result = await go('/root', 'run-1', flags({ commitMessage: 'msg', repo: 'acme/x', payloadPath: 'pr.json' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'commit');
  assert.match(result.reason, /nothing to commit/);
  assert.deepEqual(stages(calls), ['integrate', 'commit']);
});

test('go: ship never runs without both --repo and --pr; status stays integrated or committed', async () => {
  const { deps: onlyIntegrate, calls: onlyIntegrateCalls } = makeDeps();
  const integrated = await go('/root', 'run-1', flags(), onlyIntegrate);
  assert.equal(integrated.status, 'integrated');
  assert.ok(!stages(onlyIntegrateCalls).includes('ship'));

  const { deps: withCommit, calls: withCommitCalls } = makeDeps();
  const committed = await go('/root', 'run-1', flags({ commitMessage: 'msg' }), withCommit);
  assert.equal(committed.status, 'committed');
  assert.ok(!stages(withCommitCalls).includes('ship'));
});

test('go: held and ready both pass through as their own status with exit code 0', async () => {
  for (const status of ['held', 'ready']) {
    const { deps } = makeDeps({ ship: async () => ({ status }) });
    const result = await go('/root', 'run-1', flags({ repo: 'acme/x', payloadPath: 'pr.json' }), deps);
    assert.equal(result.status, status);
    assert.equal(result.stage, 'ship');
    assert.equal(goExitCode(result.status), 0);
  }
});

test('goExitCode: 0 for every non-failed status, 1 only for failed', () => {
  for (const status of ['merged', 'held', 'ready', 'integrated', 'committed']) assert.equal(goExitCode(status), 0);
  assert.equal(goExitCode('failed'), 1);
});

test('go: the result always serializes to exactly one JSON line, even with a multi-line reason', async () => {
  const { deps } = makeDeps({ ship: async () => ({ status: 'refused', reason: 'line one\nline two' }) });
  const result = await go('/root', 'run-1', flags({ repo: 'acme/x', payloadPath: 'pr.json' }), deps);
  assert.equal(result.status, 'failed');
  assert.equal(JSON.stringify(result).split('\n').length, 1);
});

test('commitOutputs: stages exactly the given files with git add -- (never -A), then commits the message verbatim', async () => {
  const execCalls = [];
  const exec = async (file, args, opts) => { execCalls.push({ file, args, opts }); return { code: 0, stdout: '', stderr: '' }; };
  const result = await commitOutputs('/root', ['a.py', 'b/c.txt'], 'exact message', { exec });
  assert.equal(result.status, 'committed');
  assert.deepEqual(execCalls[0], { file: 'git', args: ['add', '--', 'a.py', 'b/c.txt'], opts: { cwd: '/root' } });
  assert.ok(!execCalls[0].args.includes('-A'));
  assert.deepEqual(execCalls[1].args, ['commit', '-m', 'exact message']);
});

test('commitOutputs: a failing git add reports the failure and never attempts the commit', async () => {
  const execCalls = [];
  const exec = async (file, args) => { execCalls.push(args); return args[0] === 'add' ? { code: 1, stdout: '', stderr: 'fatal: bad\nmore detail' } : { code: 0, stdout: '', stderr: '' }; };
  const result = await commitOutputs('/root', ['a.py'], 'msg', { exec });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /git add failed: fatal: bad/);
  assert.equal(execCalls.length, 1);
});
