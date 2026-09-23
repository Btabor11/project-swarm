// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {installUser,installProject} from '../tools/install.mjs';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function tempDir(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return fs.realpath(dir);}

// A plain (non-git) copy of the parts installUser/installProject read. Not a git checkout,
// so the uncommitted-changes guard has nothing to detect and --dev is never required here.
async function sourceFixture(t){
 const dir=await tempDir(t);
 for(const entry of ['skills','docs','examples','SECURITY.md','CONTRIBUTING.md','package.json'])await fs.cp(path.join(packageRoot,entry),path.join(dir,entry),{recursive:true});
 return dir;
}

test('installUser writes both agent skill targets with the runner path substituted and skips a missing home',async t=>{
 const source=await sourceFixture(t),home=await tempDir(t);
 await fs.mkdir(path.join(home,'.claude'));
 const result=await installUser({source,home});
 assert.equal(result.skipped.includes('.codex'),true);
 assert.equal(result.skillTargets.some(p=>p.includes(path.join('.claude','skills','project-swarm','SKILL.md'))),true);
 assert.equal(result.skillTargets.every(p=>!p.includes('.codex')),true);
 const skillPath=path.join(home,'.claude/skills/project-swarm/SKILL.md');
 const content=await fs.readFile(skillPath,'utf8');
 const runner=path.join(source,'tools/swarm.mjs');
 assert.equal(content.includes('{{SWARM_RUNNER}}'),false);
 assert.equal(content.includes(runner),true);
 for(const file of await fs.readdir(path.join(home,'.claude/skills/project-swarm/references')))assert.ok((await fs.stat(path.join(home,'.claude/skills/project-swarm/references',file))).size>0);
 const record=JSON.parse(await fs.readFile(path.join(source,'.swarm-install.json'),'utf8'));
 assert.equal(record.version,JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version);
 assert.ok(Array.isArray(record.skillTargets)&&record.skillTargets.length>0);
 // Idempotent: rerunning writes the same set of files without error.
 const second=await installUser({source,home});
 assert.deepEqual(second.skillTargets.sort(),result.skillTargets.sort());
});

test('installUser writes into both agent homes when both exist',async t=>{
 const source=await sourceFixture(t),home=await tempDir(t);
 await fs.mkdir(path.join(home,'.claude'));await fs.mkdir(path.join(home,'.codex'));
 const result=await installUser({source,home});
 assert.deepEqual(result.skipped,[]);
 assert.equal(await fs.readFile(path.join(home,'.codex/skills/project-swarm/SKILL.md'),'utf8').then(()=>true),true);
});

test('installProject writes a pointer and the registry, and copies no runner',async t=>{
 const source=await sourceFixture(t),project=await tempDir(t);
 const result=await installProject(project,{source});
 assert.equal(result.status,'linked');
 const pointer=JSON.parse(await fs.readFile(path.join(project,'.project-swarm.json'),'utf8'));
 assert.equal(pointer.install,await fs.realpath(source));
 assert.equal(pointer.version,JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version);
 const registry=JSON.parse(await fs.readFile(path.join(source,'.swarm-projects.json'),'utf8'));
 assert.deepEqual(registry,[await fs.realpath(project)]);
 assert.equal(result.coordinationCreated,true);
 assert.ok(result.added.includes('coordination/swarm-smoke.json'));
 await assert.rejects(fs.access(path.join(project,'tools')));
 await assert.rejects(fs.access(path.join(project,'tests')));
 await assert.rejects(fs.access(path.join(project,'skills')));
});

test('installProject does not create coordination examples when the project already has some, and dedupes the registry',async t=>{
 const source=await sourceFixture(t),project=await tempDir(t);
 await fs.mkdir(path.join(project,'coordination'));
 await fs.writeFile(path.join(project,'coordination/custom.json'),'{}');
 const first=await installProject(project,{source});
 assert.equal(first.coordinationCreated,false);
 assert.deepEqual(first.added,[]);
 assert.equal(await fs.readFile(path.join(project,'coordination/custom.json'),'utf8'),'{}');
 await installProject(project,{source});
 const registry=JSON.parse(await fs.readFile(path.join(source,'.swarm-projects.json'),'utf8'));
 assert.deepEqual(registry,[await fs.realpath(project)]);
});

test('installProject rejects a symlinked destination component',async t=>{
 const source=await sourceFixture(t),project=await tempDir(t),outside=await tempDir(t);
 await fs.symlink(outside,path.join(project,'coordination'));
 await assert.rejects(installProject(project,{source}),/Symlink refused/);
 assert.deepEqual(await fs.readdir(outside),[]);
});
