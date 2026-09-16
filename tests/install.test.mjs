// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {install} from '../tools/install.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('fresh installation validates its example and repeated installation is idempotent',async t=>{
 const root=await fixture(t),first=await install(root);assert.ok(first.added.length>=12);
 assert.equal((await install(root)).added.length,0);
 const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'tools/swarm.mjs'),'validate','coordination/swarm-smoke.json'],{encoding:'utf8'}));assert.equal(result.root,await fs.realpath(root));assert.equal(result.status,'valid');
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
