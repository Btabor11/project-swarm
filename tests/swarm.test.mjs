import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runManifest, integrateRun, cancelRun, readState, validateManifest, claudeArgs } from '../tools/swarm.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-swarm-test-'));
  await fs.writeFile(path.join(root, 'input.txt'), 'original');
  await fs.writeFile(path.join(root, 'private.txt'), 'never copied');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const job = (overrides = {}) => ({ id: 'writer', agent: 'claude', prompt: 'Update the assigned file.', context: ['input.txt'], outputs: ['input.txt'], timeoutMs: 5000, ...overrides });
const manifest = jobs => ({ version: 1, concurrency: 2, jobs: jobs ?? [job()] });

// Only tests inject a provider. The production Claude adapter spawns the literal claude command.
function fake(script) {
  return (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';\n${script}`], options);
}
const done = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Worker complete'}));`;
const update = fake(`fs.writeFileSync('input.txt','updated'); ${done}`);

test('copies explicit context only, persists messages, and integrates assigned output', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: fake(`if(fs.existsSync('private.txt')) process.exit(4); fs.writeFileSync('input.txt','updated'); ${done}`) });
  assert.equal(state.status, 'complete');
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'original');
  assert.match(await fs.readFile(path.join(root, '.swarm/runs', state.id, 'writer/message.txt'), 'utf8'), /Never inspect parent/);
  assert.deepEqual((await integrateRun(root, state.id)).files, ['input.txt']);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'updated');
  await assert.rejects(integrateRun(root, state.id), /already integrated/);
});

test('rejects traversal, absolute paths, secrets, collisions, and executable adapter fields', () => {
  for (const bad of ['../escape', '/tmp/escape', 'x/../escape', 'x//y', 'x\\y', '.env.local', '.git/config']) {
    assert.throws(() => validateManifest(manifest([job({ outputs: [bad] })])), /path/i);
  }
  assert.throws(() => validateManifest(manifest([job(), job({ id: 'second' })])), /collision/);
  assert.throws(() => validateManifest(manifest([job({ command: '/tmp/evil' })])), /Unknown/);
  assert.throws(() => validateManifest(manifest([job({ agent: 'codex' })])), /Unsupported/);
  assert.throws(() => validateManifest({ ...manifest(), concurrency: 33 }), /Concurrency/);
});

test('refuses symlink context and launches no workers', async t => {
  const root = await fixture(t);
  await fs.symlink(path.join(root, 'private.txt'), path.join(root, 'linked.txt'));
  let calls = 0;
  const state = await runManifest(root, manifest([job({ context: ['linked.txt'] })]), { spawnImpl: () => { calls++; throw Error('unexpected'); } });
  assert.equal(calls, 0);
  assert.equal(state.status, 'failed');
  assert.match(state.error, /Symlink refused/);
});

test('refuses credential directories in context and outputs before copying or launching', async t => {
  const root = await fixture(t);
  for (const field of ['context', 'outputs']) {
    for (const file of ['.secrets/synthetic.json', 'nested/.SECRETS/synthetic.json']) {
      const input = manifest([job({ context: [], outputs: [], [field]: [file] })]);
      assert.throws(() => validateManifest(input), /Reserved or secret path/);
      let launched = false;
      await assert.rejects(runManifest(root, input, {
        spawnImpl() { launched = true; throw Error('Must not launch'); },
      }), /Reserved or secret path/);
      assert.equal(launched, false);
      await assert.rejects(fs.access(path.join(root, '.swarm')), { code: 'ENOENT' });
    }
  }
});

test('rejects symlink parents both when copying and when integrating', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'actual'));
  await fs.symlink(path.join(root, 'actual'), path.join(root, 'linked'));
  const bad = await runManifest(root, manifest([job({ outputs: ['linked/out.txt'] })]), { spawnImpl: update });
  assert.equal(bad.status, 'failed');
  const state = await runManifest(root, manifest(), { spawnImpl: fake(`fs.unlinkSync('input.txt'); fs.symlinkSync('${path.join(root, 'private.txt')}', 'input.txt'); ${done}`) });
  await assert.rejects(integrateRun(root, state.id), /Symlink refused/);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'original');
});

test('checks all conflicts before writing any output', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'second.txt'), 'base');
  const state = await runManifest(root, manifest([job({ outputs: ['input.txt', 'second.txt'] })]), { spawnImpl: fake(`fs.writeFileSync('input.txt','updated');fs.writeFileSync('second.txt','updated'); ${done}`) });
  await fs.writeFile(path.join(root, 'second.txt'), 'coordinator edit');
  await assert.rejects(integrateRun(root, state.id), /Integration conflict/);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(root, 'second.txt'), 'utf8'), 'coordinator edit');
});

test('supports new output files and excludes undeclared worker files', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest([job({ outputs: ['new/answer.txt'] })]), { spawnImpl: fake(`fs.mkdirSync('new');fs.writeFileSync('new/answer.txt','answer');fs.writeFileSync('unassigned.txt','discard'); ${done}`) });
  assert.deepEqual((await integrateRun(root, state.id)).files, ['new/answer.txt']);
  await assert.rejects(fs.access(path.join(root, 'unassigned.txt')));
});

test('never propagates deletions', async t => {
  const root = await fixture(t);
  const state = await runManifest(root, manifest(), { spawnImpl: fake(`fs.unlinkSync('input.txt'); ${done}`) });
  await assert.rejects(integrateRun(root, state.id), /Missing output/);
  assert.equal(await fs.readFile(path.join(root, 'input.txt'), 'utf8'), 'original');
});

test('failed exit, error result, missing result, and malformed JSONL cannot integrate', async t => {
  const root = await fixture(t);
  for (const script of ['process.exit(7)', `console.log(JSON.stringify({type:'result',is_error:true,subtype:'error'}))`, `console.log(JSON.stringify({type:'assistant'}))`, `console.log('invalid'); ${done}`]) {
    const state = await runManifest(root, manifest(), { spawnImpl: fake(script) });
    assert.equal(state.status, 'failed');
    await assert.rejects(integrateRun(root, state.id), /Only a complete run/);
  }
});

test('timeout terminates a hanging worker and records the failure', async t => {
  const root = await fixture(t);
  const start = Date.now();
  const state = await runManifest(root, manifest([job({ timeoutMs: 100 })]), { spawnImpl: fake('setInterval(()=>{},1000)') });
  assert.equal(state.jobs[0].status, 'timeout');
  assert.ok(Date.now() - start < 3000);
});

test('cancellation marker stops only this run and its queued jobs', async t => {
  const root = await fixture(t);
  const pending = runManifest(root, { ...manifest([job(), job({ id: 'review', outputs: [] })]), concurrency: 1 }, { id: 'cancel-case', spawnImpl: fake('setInterval(()=>{},1000)') });
  let state;
  for (let i = 0; i < 100; i++) {
    try { state = await readState(root, 'cancel-case'); } catch {}
    if (state?.jobs[0]?.status === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await cancelRun(root, 'cancel-case');
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.ok(result.jobs.every(entry => entry.status === 'cancelled'));
});

test('fixed Claude adapter has no shell/agent tools and passes model only when explicit', () => {
  const args = claudeArgs(job());
  assert.equal(args.includes('--model'), false);
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Write,Edit');
  assert.ok(args.includes('--restricted'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(claudeArgs(job({ model: 'claude-sonnet-4-6' })).slice(-2), ['--model', 'claude-sonnet-4-6']);
  assert.equal(claudeArgs(job({ outputs: [] }))[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
});

test('bounds simultaneous fresh processes to manifest concurrency', async t => {
  const root = await fixture(t);
  let active = 0, maximum = 0;
  const provider = fake(`setTimeout(()=>{${done}}, 70)`);
  const state = await runManifest(root, manifest(Array.from({ length: 5 }, (_, i) => job({ id: `reader-${i}`, outputs: [] }))), {
    spawnImpl: (...args) => {
      active++; maximum = Math.max(maximum, active);
      const child = provider(...args);
      child.on('close', () => active--);
      return child;
    }
  });
  assert.equal(state.status, 'complete');
  assert.equal(maximum, 2);
  assert.equal(active, 0);
});

test('external abort closes owned workers before returning', async t => {
  const root = await fixture(t);
  const controller = new AbortController();
  let closed = false;
  const provider = fake('setInterval(()=>{},1000)');
  const pending = runManifest(root, manifest(), { signal: controller.signal, spawnImpl: (...args) => {
    const child = provider(...args);
    child.on('close', () => { closed = true; });
    setTimeout(() => controller.abort(), 40);
    return child;
  } });
  const state = await pending;
  assert.equal(state.status, 'cancelled');
  assert.equal(closed, true);
});

test('case-insensitive IDs, outputs and sensitive paths are rejected', () => {
 assert.throws(()=>validateManifest(manifest([job({id:'Writer',outputs:[]}),job({id:'writer',outputs:[]})])),/duplicate/);
 assert.throws(()=>validateManifest(manifest([job({outputs:['A.txt']}),job({id:'b',outputs:['a.txt']})])),/collision/);
 for(const file of ['.ENV','x/.SSH/config','C:foo','control\nfile'])assert.throws(()=>validateManifest(manifest([job({outputs:[file]})])),/path/i);
});

test('validation is read-only and refuses missing context', async t => {
 const {validateProject}=await import('../tools/swarm.mjs');const root=await fixture(t);
 assert.equal((await validateProject(root,manifest())).status,'valid');
 await assert.rejects(fs.access(path.join(root,'.swarm')));
 await assert.rejects(validateProject(root,manifest([job({context:['missing']})])),/Missing context/);
});

test('inspection and integration preserve executable permissions and detect permission conflicts', async t => {
 const {inspectRun}=await import('../tools/swarm.mjs');const root=await fixture(t);
 await fs.chmod(path.join(root,'input.txt'),0o755);
 const state=await runManifest(root,manifest(),{spawnImpl:update});
 assert.equal((await inspectRun(root,state.id)).files[0].status,'ready');
 await fs.chmod(path.join(root,'input.txt'),0o644);
 assert.equal((await inspectRun(root,state.id)).files[0].status,'conflict');
 await assert.rejects(integrateRun(root,state.id),/permissions changed/);
 await fs.chmod(path.join(root,'input.txt'),0o755);
 await integrateRun(root,state.id);
 assert.equal((await fs.stat(path.join(root,'input.txt'))).mode&0o777,0o755);
 assert.equal((await inspectRun(root,state.id)).files[0].status,'applied');
});

test('records actual model and usage metadata from provider events', async t => {
 const root=await fixture(t);
 const state=await runManifest(root,manifest([job({outputs:[]})]),{spawnImpl:fake(`console.log(JSON.stringify({type:'system',subtype:'init',model:'actual-model'}));console.log(JSON.stringify({type:'result',subtype:'success',result:'ok',usage:{input_tokens:42},total_cost_usd:0.01,modelUsage:{'actual-model':{inputTokens:42}}}));`)});
 assert.equal(state.jobs[0].actualModel,'actual-model');assert.equal(state.jobs[0].usage.input_tokens,42);
});

test('doctor rejects incompatible CLIs without a model call', async()=>{
 const {doctor}=await import('../tools/swarm.mjs');
 await assert.rejects(doctor({exec:async(_cmd,args)=>({stdout:args[0]==='--version'?'old CLI':'--tools'})}),/lacks required flags/);
});

test('explicit concurrency four creates four simultaneous fresh processes and drains the queue', async t => {
 const root=await fixture(t);let active=0,maximum=0,launched=0;
 const provider=fake(`setTimeout(()=>{${done}},120)`);
 const state=await runManifest(root,{...manifest(Array.from({length:9},(_,i)=>job({id:`parallel-${i}`,outputs:[]}))),concurrency:4},{spawnImpl:(...args)=>{launched++;active++;maximum=Math.max(maximum,active);const child=provider(...args);child.on('close',()=>active--);return child;}});
 assert.equal(state.status,'complete');assert.equal(launched,9);assert.equal(maximum,4);assert.equal(active,0);
});

test('cancelling four live CLI processes closes them and never launches queued workers', async t => {
 const root=await fixture(t);let active=0,launched=0;
 const provider=fake('setInterval(()=>{},1000)');
 const pending=runManifest(root,{...manifest(Array.from({length:8},(_,i)=>job({id:`stop-${i}`,outputs:[]}))),concurrency:4},{id:'stop-four',spawnImpl:(...args)=>{launched++;active++;const child=provider(...args);child.on('close',()=>active--);return child;}});
 for(let i=0;i<100&&launched<4;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(launched,4);await cancelRun(root,'stop-four');const state=await pending;
 assert.equal(state.status,'cancelled');assert.equal(active,0);assert.equal(launched,4);assert.ok(state.jobs.every(entry=>entry.status==='cancelled'));
});

test('timeout kills an owned descendant even after its direct parent exits and closes stdio', async t => {
 if(process.platform==='win32')return;
 const root=await fixture(t);let descendant;
 t.after(()=>{if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}});
 const provider=fake(`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{fs.writeFileSync('descendant.pid',String(child.pid));child.stdout.destroy();});setInterval(()=>{},1000);`);
 const state=await runManifest(root,manifest([job({timeoutMs:2000})]),{spawnImpl:provider});
 descendant=Number(await fs.readFile(path.join(root,'.swarm/workspaces',state.id,'writer/descendant.pid'),'utf8'));
 assert.equal(state.jobs[0].status,'timeout');
 // On Linux an orphan may briefly be a zombie; it must no longer execute.
 const {execFileSync}=await import('node:child_process');let status='';for(let i=0;i<30;i++){try{status=execFileSync('ps',['-o','stat=','-p',String(descendant)],{encoding:'utf8'}).trim();}catch{status='';}if(!status||status.startsWith('Z'))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.ok(!status||status.startsWith('Z'),`descendant still active: ${status}`);
});

test('inspect blocks partial outputs from timed-out and cancelled jobs while integration remains forbidden', async t => {
 const {inspectRun}=await import('../tools/swarm.mjs');const root=await fixture(t);
 const partial=fake(`fs.writeFileSync('input.txt','partial edit');setInterval(()=>{},1000);`);
 const timed=await runManifest(root,manifest([job({timeoutMs:2000})]),{spawnImpl:partial});
 const timedReport=await inspectRun(root,timed.id);assert.equal(timedReport.files[0].jobStatus,'timeout');assert.equal(timedReport.files[0].status,'blocked');assert.equal(timedReport.files[0].bytes,12);await assert.rejects(integrateRun(root,timed.id),/Only a complete/);
 const pending=runManifest(root,manifest(),{id:'partial-cancel',spawnImpl:partial});
 for(let i=0;i<100;i++){let text;try{text=await fs.readFile(path.join(root,'.swarm/workspaces/partial-cancel/writer/input.txt'),'utf8');}catch{}if(text==='partial edit')break;await new Promise(resolve=>setTimeout(resolve,10));}
 await cancelRun(root,'partial-cancel');const cancelled=await pending;const report=await inspectRun(root,cancelled.id);assert.equal(report.files[0].jobStatus,'cancelled');assert.equal(report.files[0].status,'blocked');assert.equal(report.files[0].bytes,12);await assert.rejects(integrateRun(root,cancelled.id),/Only a complete/);assert.equal(await fs.readFile(path.join(root,'input.txt'),'utf8'),'original');
});

test('normal success and error exits clean surviving descendants in the owned group', async t => {
 if(process.platform==='win32')return;
 const root=await fixture(t),descendants=[];
 t.after(()=>{for(const pid of descendants)try{process.kill(pid,'SIGKILL');}catch{}});
 for(const success of [true,false]){
  const provider=fake(`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{fs.writeFileSync('descendant.pid',String(child.pid));child.stdout.destroy();${success?done:''}process.exit(${success?0:7});});`);
  const state=await runManifest(root,manifest(),{spawnImpl:provider});const pid=Number(await fs.readFile(path.join(root,'.swarm/workspaces',state.id,'writer/descendant.pid'),'utf8'));descendants.push(pid);assert.equal(state.status,success?'complete':'failed');assert.equal(state.jobs[0].cleanupError,null);
  const {execFileSync}=await import('node:child_process');let status='';for(let i=0;i<30;i++){try{status=execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim();}catch{status='';}if(!status||status.startsWith('Z'))break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(!status||status.startsWith('Z'),`descendant still active: ${status}`);
 }
});

test('cleanup signal permission failures are explicit and prevent successful integration', async t => {
 const root=await fixture(t);const attempts=[];
 const state=await runManifest(root,manifest(),{spawnImpl:update,killImpl:(target,signal)=>{attempts.push({target,signal});throw Object.assign(Error('private detail must not leak'),{code:'EPERM'});}});
 assert.equal(state.status,'failed');assert.equal(state.jobs[0].status,'failed');assert.match(state.jobs[0].cleanupError,/EPERM/);assert.match(state.jobs[0].error,/cleanup failed/);assert.ok(!JSON.stringify(state).includes('private detail'));assert.equal(attempts.length,1);assert.equal(attempts[0].signal,'SIGTERM');assert.ok(attempts[0].target<0);await assert.rejects(integrateRun(root,state.id),/Only a complete/);
});

test('SIGKILL escalation failures are reported instead of swallowed', async()=>{
 const {EventEmitter}=await import('node:events');const {stopChild}=await import('../tools/swarm.mjs');const child=new EventEmitter();child.pid=424242;const attempts=[];
 const result=await stopChild(child,{killImpl:(target,signal)=>{attempts.push({target,signal});if(signal==='SIGKILL')throw Object.assign(Error('denied'),{code:'EPERM'});}});
 assert.match(result.error,/EPERM.*SIGKILL/);assert.ok(attempts.every(call=>call.target===-424242));
});

test('cancellation cleanup denial preserves its reason, fails the run, and does not start queued jobs', async t => {
 const root=await fixture(t),controller=new AbortController();let child,launched=0;
 t.after(()=>{if(child?.pid)try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGKILL');}catch{}});
 const provider=fake('setInterval(()=>{},1000)');
 const state=await runManifest(root,{...manifest([job(),job({id:'queued',outputs:[]})]),concurrency:1},{signal:controller.signal,spawnImpl:(...args)=>{launched++;child=provider(...args);setTimeout(()=>controller.abort(),40);return child;},killImpl:()=>{throw Object.assign(Error('denied'),{code:'EPERM'});}});
 assert.equal(state.status,'failed');assert.equal(state.jobs[0].status,'failed');assert.equal(state.jobs[0].terminationReason,'cancelled');assert.match(state.jobs[0].cleanupError,/EPERM/);assert.equal(state.jobs[1].status,'cancelled');assert.equal(launched,1);await assert.rejects(integrateRun(root,state.id));
});

test('normal leader exit cleans a descendant that keeps inherited stdout open without timing out',async t=>{
 if(process.platform==='win32')return;
 const root=await fixture(t);let descendant;t.after(()=>{if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}});
 const script=`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync('ready.pid',String(process.pid));setInterval(()=>{},1000);"],{stdio:['ignore','inherit','ignore']});const poll=setInterval(()=>{if(fs.existsSync('ready.pid')){clearInterval(poll);${done}process.exit(0);}},10);`;
 const state=await runManifest(root,manifest([job({timeoutMs:2000})]),{spawnImpl:fake(script)});descendant=Number(await fs.readFile(path.join(root,'.swarm/workspaces',state.id,'writer/ready.pid'),'utf8'));
 assert.equal(state.status,'complete');assert.equal(state.jobs[0].terminationReason,null);assert.equal(state.jobs[0].cleanupError,null);assert.ok(state.jobs[0].durationMs<1800);
});
