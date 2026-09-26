// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Project Swarm contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(new URL('../tools/box-mcp.mjs', import.meta.url));
const TOKEN = 'test-token-12345';

// --- fake box HTTP server (stands in for Helm's boxes.py) --------------------------------

function startFakeBox({ token = TOKEN, execResponse = () => ({ exitCode: 0, seconds: 0.5, stdoutTail: 'ok', stderrTail: '' }) } = {}) {
  const state = { boxCreates: [], syncBodies: [], execCalls: [], deleted: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('unauthorized'); return; }
      if (req.method === 'POST' && req.url === '/v1/boxes') {
        state.boxCreates.push(JSON.parse(body.toString('utf8') || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ boxId: 'box-1' }));
        return;
      }
      if (req.method === 'POST' && /^\/v1\/boxes\/[^/]+\/sync$/.test(req.url)) {
        state.syncBodies.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.method === 'POST' && /^\/v1\/boxes\/[^/]+\/exec$/.test(req.url)) {
        const parsed = JSON.parse(body.toString('utf8'));
        state.execCalls.push(parsed.check);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(execResponse(parsed.check)));
        return;
      }
      const deleteMatch = /^\/v1\/boxes\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && deleteMatch) {
        state.deleted.push(deleteMatch[1]);
        res.writeHead(200); res.end('{}');
        return;
      }
      res.writeHead(404); res.end('not found');
    });
  });
  return { server, state };
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// --- minimal ustar reader, mirrors the server's writer for assertions ---------------------

function parseUstar(buf) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const dataStart = offset + 512;
    entries.push({ name: prefix ? `${prefix}/${name}` : name, content: buf.subarray(dataStart, dataStart + size) });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// --- MCP stdio client ----------------------------------------------------------------------

function mcpClient(child) {
  let buffer = '';
  const waiters = new Map();
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (waiters.has(message.id)) { waiters.get(message.id)(message); waiters.delete(message.id); }
    }
  });
  return {
    async call(method, params) {
      const id = nextId++;
      const promise = new Promise(resolve => waiters.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return promise;
    },
  };
}

async function stopChild(child) {
  await new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); });
}

async function setupWorkspace(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'box-mcp-workspace-'));
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(dir, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return dir;
}

async function spawnServer({ runId = 'run1', jobId = 'job1', workspaceDir, checks, maxCalls = 30, base, env = {} }) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'box-mcp-root-'));
  const checksFile = path.join(cwd, 'checks.json');
  await fs.writeFile(checksFile, JSON.stringify(checks));
  const args = [SERVER_PATH, runId, jobId, workspaceDir, checksFile, String(maxCalls)];
  if (base !== undefined) args.push(JSON.stringify(base));
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { child, cwd, client: mcpClient(child) };
}

test('enum enforcement: tools/list exposes check names, tools/call rejects unknown names', async () => {
  const workspaceDir = await setupWorkspace({ 'a.txt': 'hello' });
  const { server, state } = startFakeBox();
  const port = await listen(server);
  const { child, client } = await spawnServer({
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] }, unit: { argv: ['npm', 'run', 'unit'] } },
    env: { SWARM_BOX_URL: `http://127.0.0.1:${port}`, SWARM_BOX_TOKEN_FILE: await writeToken() },
  });
  try {
    const listed = await client.call('tools/list', {});
    const tool = listed.result.tools[0];
    assert.equal(tool.name, 'run_check');
    assert.deepEqual(tool.inputSchema.properties.name.enum.sort(), ['lint', 'unit']);

    const badCall = await client.call('tools/call', { name: 'run_check', arguments: { name: 'nope' } });
    assert.equal(badCall.result.isError, true);
    assert.match(JSON.parse(badCall.result.content[0].text).error, /Unknown check/);
    assert.equal(state.boxCreates.length, 0);
  } finally {
    await stopChild(child);
    server.close();
  }
});

test('tar contains exactly the workspace files', async () => {
  const files = { 'a.txt': 'alpha', 'sub/b.txt': 'bravo', 'sub/deep/c.txt': 'charlie' };
  const workspaceDir = await setupWorkspace(files);
  const { server, state } = startFakeBox();
  const port = await listen(server);
  const { child, client } = await spawnServer({
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    env: { SWARM_BOX_URL: `http://127.0.0.1:${port}`, SWARM_BOX_TOKEN_FILE: await writeToken() },
  });
  try {
    const result = await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(result.result.isError, false);
    assert.deepEqual(JSON.parse(result.result.content[0].text), { exitCode: 0, seconds: 0.5, stdoutTail: 'ok', stderrTail: '' });

    assert.equal(state.syncBodies.length, 1);
    const tar = zlib.gunzipSync(state.syncBodies[0]);
    const entries = parseUstar(tar);
    assert.deepEqual(entries.map(entry => entry.name).sort(), Object.keys(files).sort());
    for (const entry of entries) assert.equal(entry.content.toString('utf8'), files[entry.name]);
  } finally {
    await stopChild(child);
    server.close();
  }
});

test('box.jsonl records one line per call', async () => {
  const workspaceDir = await setupWorkspace({ 'a.txt': 'hello' });
  const { server } = startFakeBox();
  const port = await listen(server);
  const { child, cwd, client } = await spawnServer({
    runId: 'runjsonl', jobId: 'jobjsonl',
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    env: { SWARM_BOX_URL: `http://127.0.0.1:${port}`, SWARM_BOX_TOKEN_FILE: await writeToken() },
  });
  try {
    await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    await stopChild(child);

    const jsonlPath = path.join(cwd, '.swarm', 'runs', 'runjsonl', 'jobjsonl', 'box.jsonl');
    const lines = (await fs.readFile(jsonlPath, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.check, 'lint');
      assert.equal(parsed.call, index + 1);
      assert.equal(parsed.exitCode, 0);
    }
  } finally {
    server.close();
  }
});

test('unavailable path: missing env vars never throws and is reported to the worker', async () => {
  const workspaceDir = await setupWorkspace({ 'a.txt': 'hello' });
  const { child, cwd, client } = await spawnServer({
    runId: 'rununavail', jobId: 'jobunavail',
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    env: { SWARM_BOX_URL: '', SWARM_BOX_TOKEN_FILE: '' },
  });
  try {
    const result = await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(result.result.isError, false);
    const parsed = JSON.parse(result.result.content[0].text);
    assert.equal(parsed.unavailable, true);
    assert.match(parsed.reason, /SWARM_BOX_URL/);

    const jsonlPath = path.join(cwd, '.swarm', 'runs', 'rununavail', 'jobunavail', 'box.jsonl');
    const line = JSON.parse((await fs.readFile(jsonlPath, 'utf8')).trim());
    assert.equal(line.unavailable, true);
  } finally {
    await stopChild(child);
    assert.equal(child.exitCode, 0);
  }
});

test('budget exhaustion: calls beyond the budget are refused without contacting the box', async () => {
  const workspaceDir = await setupWorkspace({ 'a.txt': 'hello' });
  const { server, state } = startFakeBox();
  const port = await listen(server);
  const { child, client } = await spawnServer({
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    maxCalls: 1,
    env: { SWARM_BOX_URL: `http://127.0.0.1:${port}`, SWARM_BOX_TOKEN_FILE: await writeToken() },
  });
  try {
    const first = await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(first.result.isError, false);

    const second = await client.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(second.result.isError, true);
    assert.match(JSON.parse(second.result.content[0].text).error, /budget/i);

    assert.equal(state.execCalls.length, 1);
  } finally {
    await stopChild(child);
    server.close();
  }
});

test('base: the box create body includes base when configured, and omits it when not', async () => {
  const workspaceDir = await setupWorkspace({ 'a.txt': 'hello' });
  const { server, state } = startFakeBox();
  const port = await listen(server);
  const env = { SWARM_BOX_URL: `http://127.0.0.1:${port}`, SWARM_BOX_TOKEN_FILE: await writeToken() };

  const { child: withBase, client: withBaseClient } = await spawnServer({
    runId: 'runbase', jobId: 'jobbase',
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    base: { repo: 'cluer-helm', ref: 'a'.repeat(40) },
    env,
  });
  try {
    const result = await withBaseClient.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(result.result.isError, false);
    assert.deepEqual(state.boxCreates[0].base, { repo: 'cluer-helm', ref: 'a'.repeat(40) });
  } finally {
    await stopChild(withBase);
  }

  const { child: withoutBase, client: withoutBaseClient } = await spawnServer({
    runId: 'runnobase', jobId: 'jobnobase',
    workspaceDir,
    checks: { lint: { argv: ['npm', 'test'] } },
    env,
  });
  try {
    const result = await withoutBaseClient.call('tools/call', { name: 'run_check', arguments: { name: 'lint' } });
    assert.equal(result.result.isError, false);
    assert.equal('base' in state.boxCreates[1], false);
  } finally {
    await stopChild(withoutBase);
    server.close();
  }
});

// --- helpers ---------------------------------------------------------------------------

async function writeToken(token = TOKEN) {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'box-mcp-token-')), 'token');
  await fs.writeFile(file, token);
  return file;
}
