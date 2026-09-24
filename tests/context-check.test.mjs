// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CONTEXT_CHECK_LIMITS,
  isTestFile,
  referencePatterns,
  listProjectFiles,
  findUncoveredTests,
  suggestIgnoreTests,
} from '../tools/context-check.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('isTestFile recognizes test directories, JS/TS suffixes, Python and Go conventions', () => {
  assert.equal(isTestFile('tests/preflight.test.mjs'), true);
  assert.equal(isTestFile('test/foo.mjs'), true);
  assert.equal(isTestFile('__tests__/foo.js'), true);
  assert.equal(isTestFile('src/spec/util.js'), true);
  assert.equal(isTestFile('src/foo.test.ts'), true);
  assert.equal(isTestFile('src/foo.spec.tsx'), true);
  assert.equal(isTestFile('pkg/test_widget.py'), true);
  assert.equal(isTestFile('pkg/widget_test.py'), true);
  assert.equal(isTestFile('pkg/widget_test.go'), true);
  assert.equal(isTestFile('tools/swarm.mjs'), false);
  assert.equal(isTestFile('src/respec/foo.js'), false);
  assert.equal(isTestFile('src/guardrail.js'), false);
});

test('referencePatterns: path form matches quoted/backtick references bounded by separators', () => {
  const patterns = referencePatterns('tools/swarm.mjs');
  const samples = [
    "import x from '../tools/swarm.mjs';",
    'const p = "./swarm";',
    "path.join(root, 'tools', 'swarm.mjs')",
    'require(`../tools/swarm`)',
  ];
  for (const sample of samples) assert.ok(patterns.some(re => re.test(sample)), sample);
});

test('referencePatterns: a bare quoted stem with no leading slash and no extension does not match', () => {
  const patterns = referencePatterns('src/components/Chat.tsx');
  assert.equal(patterns.some(re => re.test("getByText('Chat')")), false);
  assert.equal(patterns.some(re => re.test('screen.getByText("Chat")')), false);
  assert.ok(patterns.some(re => re.test("import Chat from '../components/Chat';")));
  assert.ok(patterns.some(re => re.test("path.join(dir, 'Chat.tsx')")));
});

test('referencePatterns: no false positive on a longer word or different case', () => {
  const patterns = referencePatterns('a/rail.ts');
  assert.equal(patterns.some(re => re.test("import Rail from './ChatRailView';")), false);
  assert.equal(patterns.some(re => re.test('function guardrail() {}')), false);
  assert.ok(patterns.some(re => re.test("import x from './rail';")));
});

test('referencePatterns: short stems produce no patterns', () => {
  assert.deepEqual(referencePatterns('src/ab.js'), []);
  assert.deepEqual(referencePatterns('ab.py'), []);
});

test('referencePatterns: generic stems use the parent directory name', () => {
  const patterns = referencePatterns('src/widget/index.js');
  assert.ok(patterns.some(re => re.test("import Widget from '../widget';")));
  assert.equal(patterns.some(re => re.test("import x from './index';")), false);
});

test('referencePatterns: Python module forms for .py outputs', () => {
  const patterns = referencePatterns('pkg/sub/widget.py');
  assert.ok(patterns.some(re => re.test('from pkg.sub.widget import Thing')));
  assert.ok(patterns.some(re => re.test('import pkg.sub.widget')));
  assert.ok(patterns.some(re => re.test('from pkg.sub import other, widget')));
  assert.equal(patterns.some(re => re.test('import pkg.sub.otherwidget')), false);
});

test('referencePatterns: Rust mod/crate/super forms for .rs outputs', () => {
  const patterns = referencePatterns('src/widget.rs');
  assert.ok(patterns.some(re => re.test('mod widget;')));
  assert.ok(patterns.some(re => re.test('use crate::widget::Thing;')));
  assert.ok(patterns.some(re => re.test('use super::widget;')));
  assert.equal(patterns.some(re => re.test('mod otherwidget;')), false);
});

test('findUncoveredTests: reports a test that references an existing output not in context/outputs/ignoreTests', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'widget.mjs'), 'export const widget = 1;');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), "import { widget } from '../widget.mjs';");
  const job = { id: 'w', context: [], outputs: ['widget.mjs'] };
  const found = findUncoveredTests(root, job);
  assert.deepEqual(found, [{ output: 'widget.mjs', test: 'tests/widget.test.mjs' }]);
});

test('findUncoveredTests: covered by context, outputs, or ignoreTests removes the pair', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'widget.mjs'), 'export const widget = 1;');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), "import { widget } from '../widget.mjs';");
  const base = { id: 'w', outputs: ['widget.mjs'] };
  assert.deepEqual(findUncoveredTests(root, { ...base, context: ['tests/widget.test.mjs'] }), []);
  assert.deepEqual(findUncoveredTests(root, { ...base, context: [], outputs: ['widget.mjs', 'tests/widget.test.mjs'] }), []);
  assert.deepEqual(findUncoveredTests(root, { ...base, context: [], ignoreTests: ['tests/widget.test.mjs'] }), []);
});

test('findUncoveredTests: a non-existing output is skipped', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), "import { widget } from '../widget.mjs';");
  const job = { id: 'w', context: [], outputs: ['widget.mjs'] };
  assert.deepEqual(findUncoveredTests(root, job), []);
});

test('findUncoveredTests: an oversized test file is skipped', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'widget.mjs'), 'export const widget = 1;');
  await fs.mkdir(path.join(root, 'tests'));
  const filler = 'x'.repeat(CONTEXT_CHECK_LIMITS.maxTestBytes + 10);
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), `import { widget } from '../widget.mjs';\n// ${filler}`);
  const job = { id: 'w', context: [], outputs: ['widget.mjs'] };
  assert.deepEqual(findUncoveredTests(root, job), []);
});

test('listProjectFiles: lists tracked files in a git work tree via git ls-files', async t => {
  const root = await fixture(t);
  execFileSync('git', ['-C', root, 'init', '-q']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'a');
  execFileSync('git', ['-C', root, 'add', 'tracked.txt']);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@test.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'init']);
  await fs.writeFile(path.join(root, 'untracked.txt'), 'b');
  const files = listProjectFiles(root);
  assert.ok(files.includes('tracked.txt'));
  assert.equal(files.includes('untracked.txt'), false);
});

test('listProjectFiles: walks a plain directory and skips reserved/build directories', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'dep.js'), 'x');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'main.js'), 'x');
  const files = listProjectFiles(root);
  assert.ok(files.includes('src/main.js'));
  assert.equal(files.some(f => f.startsWith('node_modules/')), false);
});

test('findUncoveredTests: package.json output with test importing the package is not refused', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"myapp"}');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'integration.test.mjs'), "import { Something } from 'myapp';");
  const job = { id: 'w', context: [], outputs: ['package.json'] };
  const found = findUncoveredTests(root, job);
  assert.deepEqual(found, []);
});

test('findUncoveredTests: pyproject.toml output with test is not refused', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.poetry]');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'test_main.py'), 'import mymodule');
  const job = { id: 'w', context: [], outputs: ['pyproject.toml'] };
  const found = findUncoveredTests(root, job);
  assert.deepEqual(found, []);
});

test('findUncoveredTests: __init__.py output with test is not refused', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'src', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'pkg', '__init__.py'), '# init');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'test_pkg.py'), 'import src.pkg');
  const job = { id: 'w', context: [], outputs: ['src/pkg/__init__.py'] };
  const found = findUncoveredTests(root, job);
  assert.deepEqual(found, []);
});

test('findUncoveredTests: real module output still refuses uncovered test', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'widget.mjs'), 'export const widget = 1;');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), "import { widget } from '../widget.mjs';");
  const job = { id: 'w', context: [], outputs: ['widget.mjs'] };
  const found = findUncoveredTests(root, job);
  assert.deepEqual(found, [{ output: 'widget.mjs', test: 'tests/widget.test.mjs' }]);
});

test('suggestIgnoreTests: groups uncovered tests by job id exactly and sorts', async t => {
  const uncovered = [
    { job: 'j1', output: 'a.mjs', test: 'tests/z.test.mjs' },
    { job: 'j1', output: 'b.mjs', test: 'tests/a.test.mjs' },
    { job: 'j2', output: 'c.mjs', test: 'tests/m.test.mjs' },
    { job: 'j1', output: 'a.mjs', test: 'tests/z.test.mjs' },
  ];
  const result = suggestIgnoreTests(uncovered);
  assert.deepEqual(result, {
    j1: ['tests/a.test.mjs', 'tests/z.test.mjs'],
    j2: ['tests/m.test.mjs'],
  });
});

test('validateProject refusal carries suggestedIgnoreTests grouped by job (lesson #47)', async t => {
  const { validateProject } = await import('../tools/swarm.mjs');
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'widget.mjs'), 'export const widget = 1;');
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'widget.test.mjs'), "import { widget } from '../widget.mjs';");
  const manifest = { version: 1, jobs: [{ id: 'w', agent: 'claude', model: 'claude-haiku-4-5', prompt: 'edit widget', context: [], outputs: ['widget.mjs'] }] };
  await assert.rejects(validateProject(root, manifest), error => {
    assert.match(error.message, /Uncovered test references/);
    assert.deepEqual(error.details, { suggestedIgnoreTests: { w: ['tests/widget.test.mjs'] } });
    return true;
  });
});
