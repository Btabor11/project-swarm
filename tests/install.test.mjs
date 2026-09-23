// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {install} from '../tools/install.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return fs.realpath(root);}
test('fresh installation validates its example and repeated installation is idempotent',async t=>{
 const root=await fixture(t),first=await install(root);assert.ok(first.added.length>=12);
 assert.ok(first.added.includes('tools/codex-adapter.mjs'));
 assert.ok(first.added.includes('tests/codex-adapter.test.mjs'));
 assert.equal((await install(root)).added.length,0);
 const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'tools/swarm.mjs'),'validate','coordination/swarm-smoke.json'],{encoding:'utf8'}));assert.equal(result.root,await fs.realpath(root));assert.equal(result.status,'valid');
 const preflight=JSON.parse(execFileSync(process.execPath,[path.join(root,'tools/swarm.mjs'),'preflight','coordination/swarm-smoke.json'],{encoding:'utf8'}));assert.equal(preflight.validated,true);assert.equal(preflight.jobCount,2);assert.ok(preflight.jobs.every(job=>Array.isArray(job.files)));
 const api=JSON.parse(execFileSync(process.execPath,[path.join(root,'tools/swarm.mjs'),'doctor','ollama'],{encoding:'utf8',env:{...process.env,SWARM_OLLAMA_URL:'http://127.0.0.1:11434'}}));assert.equal(api.agent,'ollama');assert.equal(api.liveVerified,false);
 const apiManifest=JSON.parse(execFileSync(process.execPath,[path.join(root,'tools/swarm.mjs'),'validate','coordination/swarm-openai-smoke.json'],{encoding:'utf8'}));assert.equal(apiManifest.status,'valid');
 for(const file of await fs.readdir(path.join(root,'skills/project-swarm/references'))){const dir=path.join(root,'skills/project-swarm/references'),content=await fs.readFile(path.join(dir,file),'utf8');for(const match of content.matchAll(/\]\(([^)]+)\)/g)){if(!/^[a-z]+:/.test(match[1]))await fs.access(path.resolve(dir,match[1]));}}
});
test('installer refuses an existing different file before writing anything',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'coordination'));await fs.writeFile(path.join(root,'coordination/swarm-smoke.json'),'custom');
 await assert.rejects(install(root),/Refusing to overwrite/);await assert.rejects(fs.access(path.join(root,'tools/swarm.mjs')));
 assert.equal(await fs.readFile(path.join(root,'coordination/swarm-smoke.json'),'utf8'),'custom');
});
test('installer rejects symlink directories',async t=>{
 const root=await fixture(t),outside=await fixture(t);await fs.symlink(outside,path.join(root,'tools'));
 await assert.rejects(install(root),/Symlink refused/);assert.deepEqual(await fs.readdir(outside),[]);
});

test('duplicate installed destinations fail during planning before any target writes',async t=>{
 const root=await fixture(t),source=await fixture(t),packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 for(const entry of ['tools','tests','skills','examples','docs','LICENSE','NOTICE','SECURITY.md','CONTRIBUTING.md'])await fs.cp(path.join(packageRoot,entry),path.join(source,entry),{recursive:true});
 await fs.writeFile(path.join(source,'docs/SECURITY.md'),'duplicate destination');
 await assert.rejects(install(root,{source}),/Duplicate install destination: skills\/project-swarm\/references\/SECURITY\.md/);
 assert.deepEqual(await fs.readdir(root),[]);
});

test('a mid-install partial write rolls back owned files and directories while preserving existing content',async t=>{
 const root=await fixture(t),packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 await fs.mkdir(path.join(root,'tools'));
 await fs.copyFile(path.join(packageRoot,'tools/preflight.mjs'),path.join(root,'tools/preflight.mjs'));
 await fs.writeFile(path.join(root,'tools/keep.txt'),'user content');
 const originalOpen=fs.open,problem=new Error('Injected partial install write failure');
 let injected=false;
 fs.open=async function(file,...args){
  const handle=await originalOpen.call(this,file,...args);
  if(file===path.join(root,'licenses/project-swarm/NOTICE')){
   const originalWrite=handle.writeFile.bind(handle);
   handle.writeFile=async bytes=>{injected=true;await originalWrite(bytes.subarray(0,9));throw problem;};
  }
  return handle;
 };
 try{await assert.rejects(install(root),error=>error===problem);}finally{fs.open=originalOpen;}
 assert.equal(injected,true);
 assert.deepEqual(await fs.readdir(root),['tools']);
 assert.deepEqual((await fs.readdir(path.join(root,'tools'))).sort(),['keep.txt','preflight.mjs']);
 assert.equal(await fs.readFile(path.join(root,'tools/keep.txt'),'utf8'),'user content');
 assert.deepEqual(await fs.readFile(path.join(root,'tools/preflight.mjs')),await fs.readFile(path.join(packageRoot,'tools/preflight.mjs')));
});

test('an observed parent symlink introduced after planning creates nothing outside the project',async t=>{
 const root=await fixture(t),outside=await fixture(t),originalOpen=fs.open;
 let injected=false;
 fs.open=async function(file,...args){
  const handle=await originalOpen.call(this,file,...args);
  if(file===path.join(root,'tools/swarm.mjs')){injected=true;await fs.symlink(outside,path.join(root,'skills'));}
  return handle;
 };
 try{await assert.rejects(install(root),/Symlink refused/);}finally{fs.open=originalOpen;}
 assert.equal(injected,true);
 assert.deepEqual(await fs.readdir(outside),[]);
 // The injected path is not owned by the installer and must survive its rollback.
 assert.deepEqual(await fs.readdir(root),['skills']);
 assert.equal((await fs.lstat(path.join(root,'skills'))).isSymbolicLink(),true);
});
