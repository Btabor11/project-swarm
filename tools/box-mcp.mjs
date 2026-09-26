#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
// Dependency-free stdio MCP server exposing one tool, run_check, that runs a job's named
// checks inside the swarm-box OpenShell sandbox. See coordination/swarm-box/CONTRACT.md section 4.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const CHECK_NAME = /^[A-Za-z0-9 ._-]{1,60}$/;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_CALLS = 30;
// Every limit here is a variable with a default, overridable per-operator, none hard-capped.
const MAX_FILE_BYTES = Number(process.env.SWARM_BOX_MAX_FILE_BYTES) || 16 * 1024 * 1024;
const MAX_SYNC_BYTES = Number(process.env.SWARM_BOX_MAX_SYNC_BYTES) || 512 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.SWARM_BOX_REQUEST_TIMEOUT_MS) || 30000;
const EXEC_TIMEOUT_BUFFER_MS = Number(process.env.SWARM_BOX_EXEC_TIMEOUT_BUFFER_MS) || 30000;
const DELETE_TIMEOUT_MS = Number(process.env.SWARM_BOX_DELETE_TIMEOUT_MS) || 5000;

const fail = message => { throw new Error(message); };

function validateChecks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Checks file must contain a JSON object');
  const checks = {};
  for (const [name, spec] of Object.entries(raw)) {
    if (!CHECK_NAME.test(name)) fail(`Invalid check name: ${name}`);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail(`Invalid check spec: ${name}`);
    for (const key of Object.keys(spec)) if (!['argv', 'cwd', 'timeoutMs'].includes(key)) fail(`Unknown check field: ${key}`);
    if (!Array.isArray(spec.argv) || !spec.argv.length || spec.argv.some(item => typeof item !== 'string')) fail(`Check argv must be a non-empty array of strings: ${name}`);
    if (spec.cwd !== undefined) {
      if (typeof spec.cwd !== 'string' || !spec.cwd || path.isAbsolute(spec.cwd)) fail(`Invalid check cwd: ${name}`);
      if (spec.cwd.split('/').some(part => !part || part === '.' || part === '..')) fail(`Unsafe check cwd: ${name}`);
    }
    if (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1000 || spec.timeoutMs > 1800000)) fail(`Invalid check timeoutMs: ${name}`);
    checks[name] = { argv: spec.argv, cwd: spec.cwd, timeoutSeconds: Math.ceil((spec.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000) };
  }
  if (!Object.keys(checks).length) fail('Checks file must declare at least one check');
  return checks;
}

// --- minimal ustar writer ---------------------------------------------------------------

function writeOctal(buf, offset, length, value) {
  buf.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'ascii');
}

function writeChecksum(buf, value) {
  buf.write(value.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;
}

function splitUstarName(name) {
  if (Buffer.byteLength(name, 'utf8') <= 100) return { name, prefix: '' };
  const parts = name.split('/');
  for (let index = 1; index < parts.length; index++) {
    const prefix = parts.slice(0, index).join('/');
    const rest = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(rest, 'utf8') <= 100) return { name: rest, prefix };
  }
  fail(`Path too long for a tar entry: ${name}`);
}

function ustarHeader(relativePath, size, mode, mtimeSeconds) {
  const { name, prefix } = splitUstarName(relativePath);
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  writeOctal(buf, 100, 8, mode & 0o777);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, mtimeSeconds);
  buf.fill(0x20, 148, 156); // checksum placeholder while summing
  buf.write('0', 156, 1, 'ascii'); // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write(prefix, 345, 155, 'utf8');
  writeChecksum(buf, buf.reduce((sum, byte) => sum + byte, 0));
  return buf;
}

async function listWorkspaceFiles(workspaceDir) {
  const files = [];
  async function walk(dir, rel) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail(`Symlink refused: ${relPath}`);
      if (entry.isDirectory()) { await walk(path.join(dir, entry.name), relPath); continue; }
      if (entry.isFile()) files.push(relPath);
    }
  }
  await walk(workspaceDir, '');
  return files;
}

async function buildWorkspaceTarGz(workspaceDir) {
  const files = await listWorkspaceFiles(workspaceDir);
  const blocks = [];
  for (const relPath of files) {
    const absPath = path.join(workspaceDir, relPath);
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) fail(`Symlink refused: ${relPath}`); // TOCTOU guard
    if (stat.size > MAX_FILE_BYTES) fail(`File too large to sync (> ${MAX_FILE_BYTES} bytes): ${relPath}`);
    const content = await fs.readFile(absPath);
    blocks.push(ustarHeader(relPath, content.length, stat.mode, Math.floor(stat.mtimeMs / 1000)));
    blocks.push(content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks mark the end of the archive
  const tar = Buffer.concat(blocks);
  if (tar.length > MAX_SYNC_BYTES) fail(`Workspace archive exceeds sync limit (${MAX_SYNC_BYTES} bytes)`);
  return { tarGz: zlib.gzipSync(tar), files };
}

// --- box HTTP client ---------------------------------------------------------------------

function boxOrigin(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { fail(`Invalid SWARM_BOX_URL: ${rawUrl}`); }
  if (!['http:', 'https:'].includes(url.protocol)) fail(`Invalid SWARM_BOX_URL protocol: ${rawUrl}`);
  return rawUrl.replace(/\/+$/, '');
}

async function readToken(tokenFile) {
  let text;
  try { text = await fs.readFile(tokenFile, 'utf8'); }
  catch (error) { fail(`Could not read SWARM_BOX_TOKEN_FILE: ${error.message}`); }
  const token = text.trim();
  if (!token) fail('SWARM_BOX_TOKEN_FILE is empty');
  return token;
}

async function boxFetch(url, token, init, timeoutMs) {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) fail(`Box request failed (${res.status}): ${url}`);
  return res;
}

async function ensureBox(state, origin, token) {
  if (state.boxId) return state.boxId;
  const res = await boxFetch(`${origin}/v1/boxes`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: state.runId, jobId: state.jobId, checks: state.checks, ...(state.base ? { base: state.base } : {}) }),
  }, REQUEST_TIMEOUT_MS);
  const data = await res.json();
  if (typeof data?.boxId !== 'string' || !data.boxId) fail('Box create response missing boxId');
  state.boxId = data.boxId;
  return state.boxId;
}

async function syncBox(origin, token, boxId, tarGz) {
  await boxFetch(`${origin}/v1/boxes/${boxId}/sync`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/gzip' },
    body: tarGz,
  }, REQUEST_TIMEOUT_MS);
}

async function execBox(origin, token, boxId, name, timeoutSeconds) {
  const res = await boxFetch(`${origin}/v1/boxes/${boxId}/exec`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ check: name }),
  }, timeoutSeconds * 1000 + EXEC_TIMEOUT_BUFFER_MS);
  const data = await res.json();
  if ((data.exitCode !== null && !Number.isInteger(data.exitCode)) || typeof data.seconds !== 'number' || typeof data.stdoutTail !== 'string' || typeof data.stderrTail !== 'string') fail('Invalid exec response shape');
  return { exitCode: data.exitCode, seconds: data.seconds, stdoutTail: data.stdoutTail, stderrTail: data.stderrTail };
}

async function deleteBox(state) {
  if (!state.boxId || !state.origin || !state.token) return;
  // Best effort: the box is also swept by Helm's idle janitor if this delete never lands.
  try { await boxFetch(`${state.origin}/v1/boxes/${state.boxId}`, state.token, { method: 'DELETE' }, DELETE_TIMEOUT_MS); }
  catch { /* ignore */ }
}

// --- run_check ------------------------------------------------------------------------------

async function logCall(state, entry) {
  await fs.mkdir(path.dirname(state.jsonlPath), { recursive: true });
  await fs.appendFile(state.jsonlPath, `${JSON.stringify(entry)}\n`);
}

async function handleRunCheck(state, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { isError: true, text: JSON.stringify({ error: 'Invalid arguments' }) };
  const extra = Object.keys(args).filter(key => key !== 'name');
  if (extra.length) return { isError: true, text: JSON.stringify({ error: `Unknown argument: ${extra[0]}` }) };
  const { name } = args;
  if (typeof name !== 'string' || !Object.hasOwn(state.checks, name)) return { isError: true, text: JSON.stringify({ error: `Unknown check: ${name}` }) };
  if (state.calls >= state.maxCalls) {
    const message = `Call budget exhausted (max ${state.maxCalls})`;
    await logCall(state, { ts: new Date().toISOString(), call: state.calls + 1, check: name, error: message });
    return { isError: true, text: JSON.stringify({ error: message }) };
  }
  state.calls++;
  const call = state.calls;
  try {
    const rawUrl = process.env.SWARM_BOX_URL;
    const tokenFile = process.env.SWARM_BOX_TOKEN_FILE;
    if (!rawUrl || !tokenFile) fail('SWARM_BOX_URL and SWARM_BOX_TOKEN_FILE must both be set');
    const origin = boxOrigin(rawUrl);
    const token = await readToken(tokenFile);
    state.origin = origin; state.token = token;
    const { tarGz } = await buildWorkspaceTarGz(state.workspaceDir);
    await ensureBox(state, origin, token);
    await syncBox(origin, token, state.boxId, tarGz);
    const result = await execBox(origin, token, state.boxId, name, state.checks[name].timeoutSeconds);
    await logCall(state, { ts: new Date().toISOString(), call, check: name, ...result });
    return { isError: false, text: JSON.stringify(result) };
  } catch (error) {
    const result = { unavailable: true, reason: error.message };
    await logCall(state, { ts: new Date().toISOString(), call, check: name, ...result });
    return { isError: false, text: JSON.stringify(result) };
  }
}

// --- JSON-RPC over stdio ------------------------------------------------------------------

function toolDefinition(checkNames) {
  return {
    name: 'run_check',
    description: "Run one of this job's named checks inside the swarm-box sandbox.",
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: checkNames } }, required: ['name'], additionalProperties: false },
  };
}

async function handleRequest(state, request) {
  const { id, method, params } = request;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'box-mcp', version: '1.0.0' } } };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [toolDefinition(Object.keys(state.checks))] } };
  if (method === 'tools/call') {
    if (params?.name !== 'run_check') return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params?.name}` } };
    const outcome = await handleRunCheck(state, params.arguments);
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: outcome.text }], isError: outcome.isError } };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

function parseBase(baseArg) {
  if (baseArg === undefined || baseArg === '') return null;
  let base;
  try { base = JSON.parse(baseArg); } catch { fail(`Invalid base argument: ${baseArg}`); }
  if (!base || typeof base !== 'object' || Array.isArray(base)) fail(`Invalid base argument: ${baseArg}`);
  for (const key of Object.keys(base)) if (!['repo', 'ref'].includes(key)) fail(`Unknown base field: ${key}`);
  if (typeof base.repo !== 'string' || !base.repo) fail(`Invalid base.repo: ${base.repo}`);
  if (typeof base.ref !== 'string' || !base.ref) fail(`Invalid base.ref: ${base.ref}`);
  return { repo: base.repo, ref: base.ref };
}

async function main() {
  const [runId, jobId, workspaceDirArg, checksFileArg, maxCallsArg, baseArg] = process.argv.slice(2);
  if (!ID.test(runId ?? '')) fail(`Invalid run id: ${runId}`);
  if (!ID.test(jobId ?? '')) fail(`Invalid job id: ${jobId}`);
  if (!workspaceDirArg) fail('Missing workspace dir argument');
  const workspaceDir = path.resolve(workspaceDirArg);
  if (!(await fs.stat(workspaceDir)).isDirectory()) fail(`Not a directory: ${workspaceDir}`);
  if (!checksFileArg) fail('Missing checks file argument');
  const checks = validateChecks(JSON.parse(await fs.readFile(path.resolve(checksFileArg), 'utf8')));
  const maxCalls = maxCallsArg === undefined ? DEFAULT_MAX_CALLS : Number(maxCallsArg);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100000) fail(`Invalid call budget: ${maxCallsArg}`);
  const base = parseBase(baseArg);

  const state = {
    runId, jobId, workspaceDir, checks, maxCalls, calls: 0,
    boxId: null, origin: null, token: null, base,
    jsonlPath: path.resolve(process.cwd(), '.swarm', 'runs', runId, jobId, 'box.jsonl'),
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Requests are processed one at a time so budget checks and lazy box creation cannot race.
  let queue = Promise.resolve();
  rl.on('line', line => {
    if (!line.trim()) return;
    let request;
    try { request = JSON.parse(line); } catch { return; }
    queue = queue
      .then(() => handleRequest(state, request))
      .then(response => { if (response) process.stdout.write(`${JSON.stringify(response)}\n`); })
      .catch(error => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32603, message: error.message } })}\n`));
  });
  await new Promise(resolve => rl.on('close', resolve));
  await queue.catch(() => {});
  await deleteBox(state);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
