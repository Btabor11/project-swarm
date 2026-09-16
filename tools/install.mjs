#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function safeTarget(root,relative){
 let target=root;
 for(const part of relative.split('/')){
  target=path.join(target,part);
  try{const stat=await fs.lstat(target);if(stat.isSymbolicLink())throw Error(`Symlink refused: ${relative}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return target;
}

export async function install(targetDirectory,{source=packageRoot}={}){
 const root=await fs.realpath(targetDirectory);
 if(!(await fs.stat(root)).isDirectory())throw Error('Target must be an existing project directory');
 const pairs=[['tools/api-adapters.mjs','tools/api-adapters.mjs'],['tests/adapters.test.mjs','tests/adapters.test.mjs'],['tools/swarm.mjs','tools/swarm.mjs'],['tests/swarm.test.mjs','tests/swarm.test.mjs'],['skills/project-swarm/SKILL.md','skills/project-swarm/SKILL.md'],['LICENSE','licenses/project-swarm/LICENSE'],['NOTICE','licenses/project-swarm/NOTICE'],['SECURITY.md','skills/project-swarm/references/SECURITY.md'],['CONTRIBUTING.md','skills/project-swarm/references/CONTRIBUTING.md'],['examples/smoke.json','coordination/swarm-smoke.json'],['examples/parallel-review.json','coordination/swarm-parallel-review.json']];
 for(const file of (await fs.readdir(path.join(source,'examples'))).filter(f=>f.endsWith('.json')&&!['smoke.json','parallel-review.json'].includes(f)).sort())pairs.push([`examples/${file}`,`coordination/swarm-${file}`]);
 for(const file of (await fs.readdir(path.join(source,'docs'))).filter(f=>f.endsWith('.md')).sort())pairs.push([`docs/${file}`,`skills/project-swarm/references/${file}`]);
 const plan=[];
 // Validate all destinations before writing the first file.
 for(const [from,to] of pairs){
  const destination=await safeTarget(root,to);
  let bytes=await fs.readFile(path.join(source,from));
  if(to.startsWith('skills/project-swarm/references/'))bytes=Buffer.from(bytes.toString('utf8').replace(/\]\(\.\.\/(SECURITY|CONTRIBUTING)\.md\)/g,']($1.md)').replace(/\]\(docs\//g,']('));
  let existing;try{existing=await fs.readFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&!existing.equals(bytes))throw Error(`Refusing to overwrite ${to}; review and back up the existing version first`);
  plan.push({from,to,destination,bytes,exists:existing!==undefined});
 }
 const added=[];
 try{
  for(const file of plan){if(file.exists)continue;await fs.mkdir(path.dirname(file.destination),{recursive:true});await safeTarget(root,file.to);await fs.writeFile(file.destination,file.bytes,{flag:'wx',mode:0o644});added.push(file.to);}
 }catch(error){for(const file of added.reverse())await fs.unlink(await safeTarget(root,file)).catch(()=>{});throw error;}
 return {status:'installed',root,added,unchanged:plan.filter(p=>p.exists).map(p=>p.to),next:'Add .swarm/ to your project .gitignore, then run node tools/swarm.mjs doctor and node tools/swarm.mjs validate coordination/swarm-smoke.json'};
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const [target,...rest]=process.argv.slice(2);
 if(!target||rest.length){process.stderr.write('Usage: node tools/install.mjs /path/to/existing-project\n');process.exitCode=1;}
 else try{process.stdout.write(JSON.stringify(await install(target))+'\n');}catch(error){process.stderr.write(JSON.stringify({status:'error',error:error.message})+'\n');process.exitCode=1;}
}
