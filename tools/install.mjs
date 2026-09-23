#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execFileAsync=promisify(execFile);
const AGENT_HOMES=['.claude','.codex'];

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

async function gitDirty(dir,paths){
 try{
  const {stdout}=await execFileAsync('git',['-C',dir,'status','--porcelain','--',...paths],{encoding:'utf8'});
  return stdout.trim().length>0;
 }catch{return false;} // not a git checkout (e.g. a release archive): nothing to protect against
}

async function skillFilePairs(source){
 const pairs=[['skills/project-swarm/SKILL.md','SKILL.md'],['SECURITY.md','references/SECURITY.md'],['CONTRIBUTING.md','references/CONTRIBUTING.md']];
 for(const file of (await fs.readdir(path.join(source,'docs'))).filter(f=>f.endsWith('.md')).sort())pairs.push([`docs/${file}`,`references/${file}`]);
 return pairs;
}

// Installs the skill once per agent home for every project on this machine. Idempotent: it
// only ever writes files inside <agentHome>/skills/project-swarm and always overwrites them.
export async function installUser({source=packageRoot,home=os.homedir(),dev=false}={}){
 source=await fs.realpath(source);
 if(!dev&&await gitDirty(source,['tools','skills']))throw Error('Refusing to install from a checkout with uncommitted changes to tools/ or skills/; commit or stash them, or pass --dev for a development checkout');
 const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
 const runner=path.join(source,'tools/swarm.mjs');
 const pairs=await skillFilePairs(source);
 const skipped=[],written=[];
 for(const dir of AGENT_HOMES){
  const agentHome=path.join(home,dir);
  let exists=false;
  try{exists=(await fs.stat(agentHome)).isDirectory();}catch{exists=false;}
  if(!exists){skipped.push(dir);continue;}
  for(const [from,to] of pairs){
   let text=(await fs.readFile(path.join(source,from))).toString('utf8');
   if(to.startsWith('references/'))text=text.replace(/\]\(\.\.\/(SECURITY|CONTRIBUTING)\.md\)/g,']($1.md)').replace(/\]\(docs\//g,'](');
   text=text.split('{{SWARM_RUNNER}}').join(runner);
   const relTarget=`skills/project-swarm/${to}`;
   await safeTarget(agentHome,relTarget,{createParents:true});
   const destination=await safeTarget(agentHome,relTarget);
   await fs.writeFile(destination,text,'utf8');
   written.push(destination);
  }
 }
 const record={version:pkg.version,installedAt:new Date().toISOString(),skillTargets:written};
 const recordPath=path.join(source,'.swarm-install.json');
 await fs.writeFile(recordPath,`${JSON.stringify(record,null,2)}\n`);
 return {status:'installed',version:pkg.version,source,skillTargets:written,skipped,installRecord:recordPath};
}

async function hasExistingCoordination(root){
 try{return (await fs.readdir(path.join(root,'coordination'))).length>0;}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
}

// Links one project to a shared install instead of copying the runner into it. The project
// gets a small pointer file; the install root keeps a deduped registry of linked projects.
export async function installProject(targetDirectory,{source=packageRoot}={}){
 const root=await fs.realpath(targetDirectory);
 if(!(await fs.stat(root)).isDirectory())throw Error('Target must be an existing project directory');
 const installRoot=await fs.realpath(source);
 const pkg=JSON.parse(await fs.readFile(path.join(installRoot,'package.json'),'utf8'));
 const pointer={install:installRoot,version:pkg.version};
 const pointerDestination=await safeTarget(root,'.project-swarm.json');
 await fs.writeFile(pointerDestination,`${JSON.stringify(pointer,null,2)}\n`);
 const registryPath=path.join(installRoot,'.swarm-projects.json');
 let registry=[];
 try{registry=JSON.parse(await fs.readFile(registryPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!Array.isArray(registry))registry=[];
 if(!registry.includes(root)){registry.push(root);await fs.writeFile(registryPath,`${JSON.stringify(registry,null,2)}\n`);}
 let added=[];
 if(!(await hasExistingCoordination(root))){
  const pairs=[['examples/smoke.json','coordination/swarm-smoke.json'],['examples/parallel-review.json','coordination/swarm-parallel-review.json']];
  for(const file of (await fs.readdir(path.join(installRoot,'examples'))).filter(f=>f.endsWith('.json')&&!['smoke.json','parallel-review.json'].includes(f)).sort())pairs.push([`examples/${file}`,`coordination/swarm-${file}`]);
  for(const [from,to] of pairs){
   const destination=await safeTarget(root,to,{createParents:true});
   let existing;try{existing=await fs.readFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(existing!==undefined)continue; // created by a concurrent actor since the directory check above
   const bytes=await fs.readFile(path.join(installRoot,from));
   await fs.writeFile(destination,bytes,{flag:'wx'});
   added.push(to);
  }
 }
 return {status:'linked',root,install:installRoot,version:pkg.version,pointer:'.project-swarm.json',coordinationCreated:added.length>0,added};
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);
 try{
  let result;
  if(argv[0]==='--user'){
   const flags=argv.slice(1);
   if(flags.some(flag=>flag!=='--dev'))throw Error('Usage: node tools/install.mjs --user [--dev]');
   result=await installUser({dev:flags.includes('--dev')});
  }else{
   const [target,...rest]=argv;
   if(!target||rest.length)throw Error('Usage: node tools/install.mjs --user [--dev] | /path/to/existing-project');
   result=await installProject(target);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
 }catch(error){process.stderr.write(`${JSON.stringify({status:'error',error:error.message})}\n`);process.exitCode=1;}
}
