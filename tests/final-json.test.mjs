// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFinalJson } from '../tools/swarm.mjs';

const result = { files_changed: ['a.txt'], notes: ['done'] };

test('a plain final JSON line after prose still parses (unchanged behavior)', () => {
  assert.deepEqual(parseFinalJson(`Did the work.\n${JSON.stringify(result)}\n`), result);
});

test('a final line wrapped in single backticks parses (lesson #54)', () => {
  assert.deepEqual(parseFinalJson(`Summary text.\n\`${JSON.stringify(result)}\`\n`), result);
});

test('a pretty-printed object in a ```json fence parses when no line does (lesson #58)', () => {
  const text = `Here is the result:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
  assert.deepEqual(parseFinalJson(text), result);
});

test('the last fenced object wins over an earlier one', () => {
  const text = `\`\`\`json\n{\n  "notes": ["first"]\n}\n\`\`\`\nthen\n\`\`\`\n{\n  "notes": ["second"]\n}\n\`\`\`\n`;
  assert.deepEqual(parseFinalJson(text), { notes: ['second'] });
});

test('prose with no JSON object, an array, or empty input gives null', () => {
  assert.equal(parseFinalJson('All done, no JSON here.'), null);
  assert.equal(parseFinalJson('```json\n[1, 2]\n```'), null);
  assert.equal(parseFinalJson('`[1,2]`'), null);
  assert.equal(parseFinalJson(''), null);
  assert.equal(parseFinalJson(undefined), null);
});

test('validate in a non-git root prints nothing from git on stderr (lesson #57)', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-nongit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'input.txt'), 'x');
  await fs.writeFile(path.join(root, 'm.json'), JSON.stringify({ version: 1, jobs: [{ id: 'w', agent: 'claude', model: 'sonnet', prompt: 'p', context: ['input.txt'], outputs: ['out.txt'] }] }));
  const swarm = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'swarm.mjs');
  const run = spawnSync(process.execPath, [swarm, '--root', root, 'validate', 'm.json'], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) } });
  const stderr = run.stderr ?? '';
  assert.equal(run.status, 0, stderr);
  assert.doesNotMatch(stderr, /not a git repository/);
});
