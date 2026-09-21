import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runManifest, integrateRun } from '../tools/swarm.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-image-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const manifest = { version: 1, concurrency: 1, jobs: [{ id: 'review', agent: 'claude', prompt: 'Review synthetic data.', context: [], outputs: [], timeoutMs: 15000 }] };
const fake = script => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `import {once} from 'node:events'; const emit=async text=>{if(!process.stdout.write(text))await once(process.stdout,'drain');}; ${script}`], options);
const done = `await emit(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Reviewed ✅',usage:{input_tokens:41},modelUsage:{synthetic:{costUSD:0.02}},total_cost_usd:0.02}));`;
const event = `({type:'user',message:{content:[{type:'tool_result',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:encoded}},{type:'text',text:'Keep packaging text and tool warnings ✅'}]}]},tool_use_result:{type:'image',file:{base64:encoded,type:'image/jpeg',originalSize:bytes.length,dimensions:{width:1,height:1}}}})`;

async function transcript(root, state) {
  return fs.readFile(path.join(root, '.swarm/runs', state.id, 'review/provider.jsonl'), 'utf8');
}

test('image-heavy Claude Read events exceed raw 16 MiB but preserve provenance and final metadata', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest, { spawnImpl: fake(`
    const bytes=Buffer.alloc(800000,0xa5),encoded=bytes.toString('base64');
    await emit(JSON.stringify({type:'system',subtype:'init',model:'synthetic-image-model'})+'\\n');
    for(let i=0;i<10;i++)await emit(JSON.stringify(${event})+'\\n');
    process.stderr.write('retained tool error detail');
    ${done}
  `) });
  assert.equal(state.status, 'complete');
  const log = await transcript(root, state), events = log.trim().split('\n').map(JSON.parse);
  assert.ok(Buffer.byteLength(log) < 20000, 'base64 duplication must not consume the retained log');
  const expected = { omitted: 'image-base64', encoding: 'base64', encodedBytes: Buffer.alloc(800000).toString('base64').length, decodedBytes: 800000, sha256: crypto.createHash('sha256').update(Buffer.alloc(800000, 0xa5)).digest('hex') };
  for (const entry of events.filter(e => e.type === 'user')) {
    assert.deepEqual(entry.message.content[0].content[0].source.data, expected);
    assert.deepEqual(entry.tool_use_result.file.base64, expected);
    assert.equal(entry.message.content[0].content[0].source.media_type, 'image/jpeg');
    assert.equal(entry.tool_use_result.file.originalSize, 800000);
    assert.match(entry.message.content[0].content[1].text, /tool warnings ✅/);
  }
  assert.equal(state.jobs[0].actualModel, 'synthetic-image-model');
  assert.deepEqual(state.jobs[0].usage, { input_tokens: 41 });
  assert.equal(state.jobs[0].costUsd, 0.02);
  assert.equal(events.at(-1).result, 'Reviewed ✅');
  assert.equal(state.jobs[0].progress.stdoutBytes, Buffer.byteLength(log));
  assert.equal(await fs.readFile(path.join(root, '.swarm/runs', state.id, 'review/stderr.log'), 'utf8'), 'retained tool error detail');
});

test('chunk boundaries, final unterminated JSONL and ordinary base64-like text are preserved', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest, { spawnImpl: fake(`
    const bytes=Buffer.from('synthetic image'),encoded=bytes.toString('base64');
    const image=JSON.stringify(${event})+'\\n';
    for(let i=0;i<image.length;i+=7)await emit(image.slice(i,i+7));
    await emit(JSON.stringify({type:'assistant',data:encoded,base64:encoded,message:{content:[{type:'text',text:encoded}]}})+'\\n');
    ${done}
  `) });
  assert.equal(state.status, 'complete');
  const events = (await transcript(root, state)).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].tool_use_result.file.base64.omitted, 'image-base64');
  assert.equal(events[1].data, Buffer.from('synthetic image').toString('base64'));
  assert.equal(events[1].message.content[0].text, events[1].data);
  assert.equal(events.at(-1).result, 'Reviewed ✅');
});

test('malformed JSONL still fails rather than hiding provider errors', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest, { spawnImpl: fake(`await emit('malformed tool event\\n'); ${done}`) });
  assert.equal(state.status, 'failed');
  assert.match(state.jobs[0].error, /Malformed provider JSONL/);
  assert.match(await transcript(root, state), /malformed tool event/);
  await assert.rejects(integrateRun(root, state.id), /Only a complete run/);
});

for (const stream of ['stdout', 'stderr']) test(`retained ${stream} text keeps the 16 MiB cap`, async t => {
  const root = await fixture(t);
  const script = stream === 'stdout'
    ? `await emit(JSON.stringify({type:'assistant',message:'x'.repeat(17*1024*1024)})+'\\n'); setInterval(()=>{},1000);`
    : `process.stderr.write('x'.repeat(17*1024*1024)); ${done}`;
  const state = await runManifest(root, manifest, { spawnImpl: fake(script) });
  assert.equal(state.status, 'failed');
  assert.match(state.jobs[0].error, /Worker log exceeded 16 MiB/);
  assert.ok(Buffer.byteLength(await transcript(root, state)) <= 16 * 1024 * 1024);
});

test('a raw JSONL line without a newline has a separate bounded memory limit', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest, { spawnImpl: fake(`for(let i=0;i<65;i++)await emit('x'.repeat(1024*1024));`) });
  assert.equal(state.status, 'failed');
  assert.match(state.jobs[0].error, /Worker JSONL line exceeded 64 MiB/);
  assert.equal(await transcript(root, state), '');
});

test('deep image metadata fails the worker without crashing the coordinator or retaining raw payloads', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest, { spawnImpl: fake(`
    const image={type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from('synthetic deep image').toString('base64')}};
    await emit('{"type":"user","deep":'+'{"nested":'.repeat(12000)+JSON.stringify(image)+'}'.repeat(12000)+'}\\n');
    setInterval(()=>{},1000);
  `) });
  assert.equal(state.status, 'failed');
  assert.equal(state.jobs[0].terminationReason, 'Worker log processing failed');
  assert.equal(await transcript(root, state), '');
  await assert.rejects(integrateRun(root, state.id), /Only a complete run/);
});
