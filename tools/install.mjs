#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function safeTarget(root,relative,{createParents=false,created=[]}={}){
 let target=root;
 const parts=relative.split('/');
 for(let index=0;index<parts.length;index++){
  target=path.join(target,parts[index]);
  let stat;
  try{stat=await fs.lstat(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!stat&&createParents&&index<parts.length-1){
   // Recheck ancestors before each nonrecursive mutation. This is a guard against
   // observed path swaps, not an OS sandbox or a claim to eliminate every TOCTOU race.
   const partial=parts.slice(0,index+1).join('/');
   await safeTarget(root,partial);
   try{await fs.mkdir(target);created.push(partial);}catch(error){if(error.code!=='EEXIST')throw error;}
   stat=await fs.lstat(target);
  }
  if(stat?.isSymbolicLink())throw Error(`Symlink refused: ${relative}`);
  if(stat&&index<parts.length-1&&!stat.isDirectory())throw Error(`Non-directory parent: ${relative}`);
 }
 return target;
}

export async function install(targetDirectory,{source=packageRoot}={}){
 const root=await fs.realpath(targetDirectory);
 if(!(await fs.stat(root)).isDirectory())throw Error('Target must be an existing project directory');
 const pairs=[['tools/preflight.mjs','tools/preflight.mjs'],['tools/monitor-view.mjs','tools/monitor-view.mjs'],['tests/monitor-view.test.mjs','tests/monitor-view.test.mjs'],['tests/preflight.test.mjs','tests/preflight.test.mjs'],['tests/live-progress.test.mjs','tests/live-progress.test.mjs'],['tools/cli-adapters.mjs','tools/cli-adapters.mjs'],['tests/cli-adapters.test.mjs','tests/cli-adapters.test.mjs'],['tools/api-adapters.mjs','tools/api-adapters.mjs'],['tests/adapters.test.mjs','tests/adapters.test.mjs'],['tools/swarm.mjs','tools/swarm.mjs'],['tests/swarm.test.mjs','tests/swarm.test.mjs'],['skills/project-swarm/SKILL.md','skills/project-swarm/SKILL.md'],['LICENSE','licenses/project-swarm/LICENSE'],['NOTICE','licenses/project-swarm/NOTICE'],['SECURITY.md','skills/project-swarm/references/SECURITY.md'],['CONTRIBUTING.md','skills/project-swarm/references/CONTRIBUTING.md'],['examples/smoke.json','coordination/swarm-smoke.json'],['examples/parallel-review.json','coordination/swarm-parallel-review.json']];
 for(const file of (await fs.readdir(path.join(source,'examples'))).filter(f=>f.endsWith('.json')&&!['smoke.json','parallel-review.json'].includes(f)).sort())pairs.push([`examples/${file}`,`coordination/swarm-${file}`]);
 for(const file of (await fs.readdir(path.join(source,'docs'))).filter(f=>f.endsWith('.md')).sort())pairs.push([`docs/${file}`,`skills/project-swarm/references/${file}`]);
 const plan=[],destinations=new Set();
 // Validate all destinations before writing the first file.
 for(const [from,to] of pairs){
  const key=to.toLowerCase();
  if(destinations.has(key))throw Error(`Duplicate install destination: ${to}`);
  destinations.add(key);
  const destination=await safeTarget(root,to);
  let bytes=await fs.readFile(path.join(source,from));
  if(to.startsWith('skills/project-swarm/references/'))bytes=Buffer.from(bytes.toString('utf8').replace(/\]\(\.\.\/(SECURITY|CONTRIBUTING)\.md\)/g,']($1.md)').replace(/\]\(docs\//g,']('));
  let existing;try{existing=await fs.readFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&!existing.equals(bytes))throw Error(`Refusing to overwrite ${to}; review and back up the existing version first`);
  plan.push({from,to,destination,bytes,exists:existing!==undefined});
 }
 const added=[],created=[];
 try{
  for(const file of plan){
   if(file.exists)continue;
   await safeTarget(root,file.to,{createParents:true,created});
   await safeTarget(root,file.to);
   const handle=await fs.open(file.destination,'wx',0o644);
   // Track ownership immediately so a partial write is rolled back too.
   added.push(file.to);
   try{await handle.writeFile(file.bytes);await handle.close();}
   catch(error){await handle.close().catch(()=>{});throw error;}
  }
 }catch(error){
  // Best effort cleanup cannot replace the original failure or remove preexisting
  // directories. rmdir also preserves a new directory another actor has populated.
  for(const file of [...added].reverse())try{await fs.unlink(await safeTarget(root,file));}catch{}
  for(const directory of [...created].reverse())try{await fs.rmdir(await safeTarget(root,directory));}catch{}
  throw error;
 }
 return {status:'installed',root,added,unchanged:plan.filter(p=>p.exists).map(p=>p.to),next:'Add .swarm/ to your project .gitignore, then run node tools/swarm.mjs doctor and node tools/swarm.mjs preflight coordination/swarm-smoke.json'};
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const [target,...rest]=process.argv.slice(2);
 if(!target||rest.length){process.stderr.write('Usage: node tools/install.mjs /path/to/existing-project\n');process.exitCode=1;}
 else try{process.stdout.write(JSON.stringify(await install(target))+'\n');}catch(error){process.stderr.write(JSON.stringify({status:'error',error:error.message})+'\n');process.exitCode=1;}
}
