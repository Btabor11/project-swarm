// SPDX-License-Identifier: Apache-2.0
// Codex's outer macOS seatbelt, not its prompt or built-in sandbox, is the boundary.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { execViaFile } from './cli-adapters.mjs';

const execGit = promisify(execFile);
export const CODEX_MODEL = /^[A-Za-z0-9._:-]{1,80}$/;
export const CODEX_FLAGS = ['-m', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ephemeral', '-C', '-o'];
export function requireCodexPlatform(platform = process.platform) {
  if (platform !== 'darwin') throw Error('codex is unsupported on this platform: macOS seatbelt is required');
}
export function sandboxPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /["\\\x00-\x1f\x7f]/.test(value)) throw Error('Unsafe sandbox path');
  return path.resolve(value);
}
const deniedPaths = home => ['.oasis', 'Library/Keychains', '.ssh', '.aws', '.config'].map(part => path.join(home, part));
const within = (file, parent) => file === parent || file.startsWith(`${parent}/`);
export function validateReadPaths(paths = [], home = os.homedir()) {
  home = sandboxPath(home);
  if (!Array.isArray(paths) || paths.length > 100) throw Error('readPaths must be an array of at most 100 absolute paths');
  return paths.map(value => {
    const file = sandboxPath(value);
    if (deniedPaths(home).some(denied => within(file.toLowerCase(), denied.toLowerCase()))) throw Error('readPaths cannot grant a denied home directory');
    return file;
  });
}
export async function resolveReadPaths(paths = [], home = os.homedir()) {
  const validated = validateReadPaths(paths, home);
  // Reject aliases into denied directories as well as their literal spellings.
  return validateReadPaths(await Promise.all(validated.map(file => fs.realpath(file))), home);
}
export function codexProfile({ home = os.homedir(), worktree, commonDir, metadataDir, readPaths = [] }) {
  home = sandboxPath(home);
  const reads = [worktree, commonDir, ...['.codex', '.nvm', '.cache', '.npm', '.local/share/uv', 'Library/Caches'].map(p => path.join(home, p)), ...validateReadPaths(readPaths, home)].map(sandboxPath);
  const writes = [worktree, metadataDir, ...['.codex', '.cache', '.npm'].map(p => path.join(home, p)), '/private/tmp', '/private/var/folders'].map(sandboxPath);
  const filter = (kind, file) => `(${kind} "${sandboxPath(file)}")`;
  const ancestors = new Set([home]);
  for (const file of [...reads, metadataDir]) {
    let parent = path.dirname(sandboxPath(file));
    while (within(parent, home)) { ancestors.add(parent); if (parent === home) break; parent = path.dirname(parent); }
  }
  const writable = [...writes.map(file => filter('subpath', file)), '(literal "/dev/null")', '(regex #"^/dev/tty.*$")'].join(' ');
  return `(version 1)\n(allow default)\n(deny file-read* file-write* ${filter('subpath', home)})\n` +
    `(allow file-read* ${[...ancestors].map(file => filter('literal', file)).join(' ')} ${reads.map(file => filter('subpath', file)).join(' ')} ${filter('literal', path.join(home, '.gitconfig'))})\n` +
    `(allow file-write* ${writable})\n(deny file-write* (require-not (require-any ${writable})))\n` +
    `(deny file-read* file-write* ${deniedPaths(home).map(file => filter('subpath', file)).join(' ')})\n` +
    '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))\n';
}
export function codexArgs(job, { profile, worktree, lastMessage, message }) {
  if (typeof job.model !== 'string' || !CODEX_MODEL.test(job.model)) throw Error('codex requires a valid explicit model');
  return ['-f', sandboxPath(profile), 'codex', 'exec', '-m', job.model, '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ephemeral', '-C', sandboxPath(worktree), '-o', sandboxPath(lastMessage), message];
}
export function codexMessage(job) {
  return `You are a fresh worker in a detached git worktree. Read these context files first: ${JSON.stringify(job.context)}. You may edit only these declared outputs: ${JSON.stringify(job.outputs)}. Do not delete files. Run relevant project tests. Root uncommitted changes are not included. Finish with exactly one JSON line {"files_changed":[...],"notes":[...]} listing changed declared paths and concise notes.\n\nTASK:\n${job.prompt}\n`;
}
export function parseCodexResult(text, outputs) {
  let value;
  try { value = JSON.parse(text.trim()); } catch { throw Error('Codex final message is not a JSON result'); }
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'files_changed,notes' ||
      !Array.isArray(value.files_changed) || !Array.isArray(value.notes) || value.notes.some(note => typeof note !== 'string') ||
      value.files_changed.some(file => typeof file !== 'string' || !outputs.includes(file)) || new Set(value.files_changed).size !== value.files_changed.length) throw Error('Invalid Codex result envelope');
  return value;
}
export function codexUsage(output) {
  const matches = [...output.matchAll(/\btokens used\s*\n?\s*([0-9][0-9,]*)\s*(?=\n|$)/gi)];
  const count = Number(matches.at(-1)?.[1].replaceAll(',', ''));
  return Number.isSafeInteger(count) && count >= 0 ? { total_tokens: count } : null;
}
export async function codexEnvironment(env = process.env, exists = async file => fs.access(file).then(() => true, () => false)) {
  return { ...env, ...(await exists('/etc/ssl/cert.pem') ? { SSL_CERT_FILE: '/etc/ssl/cert.pem' } : {}) };
}
export async function git(root, args) {
  return (await execGit('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
}
export async function codexDirtyFiles(root, job) {
  const files = [...new Set([...job.context, ...job.outputs])];
  const dirty = [];
  for (const file of files) {
    // Literal pathspecs handle brackets and other git metacharacters in declared names.
    const spec = `:(literal)${file}`;
    if ((await git(root, ['diff', '--name-only', 'HEAD', '--', spec])).trim() ||
        (await git(root, ['diff', '--cached', '--name-only', 'HEAD', '--', spec])).trim() ||
        (await git(root, ['ls-files', '--others', '--exclude-standard', '--', spec])).trim() ||
        (await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', spec])).trim()) dirty.push(file);
  }
  return dirty;
}
export async function codexDoctor({ platform = process.platform, exec = execViaFile } = {}) {
  if (platform !== 'darwin') return { agent: 'codex', status: 'unsupported', platform, configured: false, liveVerified: false, note: 'macOS seatbelt is required' };
  const options = { timeout: 10000, maxBuffer: 1024 * 1024 };
  await exec('/usr/bin/which', ['sandbox-exec'], options);
  const version = await exec('codex', ['--version'], options);
  await exec('codex', ['login', 'status'], options);
  let help = await exec('codex', ['exec', '--help'], options).catch(() => ({ stdout: '' }));
  const missing = () => CODEX_FLAGS.filter(flag => !new RegExp(`(^|[\\s,])${flag}(?=[\\s,=]|$)`, 'm').test(help.stdout));
  if (missing().length) help = await exec('codex', ['exec', '--help'], options).catch(() => ({ stdout: '' }));
  if (!help.stdout) throw Error('Codex help probe failed (no or empty output)');
  if (missing().length) throw Error(`Codex lacks required flags: ${missing().join(', ')}`);
  return { agent: 'codex', status: 'compatible', platform, version: version.stdout.trim(), auth: 'login status succeeded', liveVerified: false };
}
