// SPDX-License-Identifier: Apache-2.0
// Ships a reviewed run's integrated tree: push the branch, open or update a PR, wait for CI,
// and merge when everything is green and nobody has asked for a human to look first. No shell:
// git and gh are invoked through the injected `exec` with an argv array.
import fs from 'node:fs/promises';

export const SHIP_DEFAULTS = Object.freeze({ pollMs: 20_000, timeoutMs: 45 * 60_000, noCiGraceMs: 5 * 60_000, mergeMethod: 'squash' });
export const CHECKS_PLACEHOLDER = '<!-- swarm:checks -->';
export const SWARM_MARKER_RE = /<!-- swarm:[a-z0-9_-]+ -->/g;

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_RE = /^[A-Za-z0-9._\/-]{1,200}$/;
const REQUIRED_PAYLOAD_FIELDS = ['title', 'head', 'base', 'body'];
const ALLOWED_EXTRA_PAYLOAD_FIELDS = new Set(['draft', 'maintainer_can_modify']);
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);
const VALID_MERGE_METHODS = new Set(['squash', 'merge', 'rebase']);

function firstStderrLine(stderr) {
  const line = String(stderr ?? '').split('\n')[0] ?? '';
  return line.slice(0, 200);
}

function stepFailed(step, res) {
  return `${step} failed: ${firstStderrLine(res.stderr)}`;
}

function getMarkerForSection(body, sectionName) {
  const lines = String(body ?? '').split('\n');
  const at = lines.findIndex(line => line === `## ${sectionName}`);
  if (at === -1) return null;
  const nextHeading = lines.slice(at + 1).findIndex(line => line.startsWith('## '));
  const end = nextHeading === -1 ? lines.length : at + 1 + nextHeading;
  const content = lines.slice(at + 1, end).join('\n');
  const matches = content.match(SWARM_MARKER_RE);
  if (!matches) return null;
  const markerMatch = matches[0].match(/swarm:([a-z0-9_-]+)/);
  return markerMatch ? markerMatch[1] : null;
}

export function parsePrPayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid PR payload JSON: ${err.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('PR payload must be a JSON object');
  for (const key of Object.keys(data)) {
    if (!REQUIRED_PAYLOAD_FIELDS.includes(key) && !ALLOWED_EXTRA_PAYLOAD_FIELDS.has(key)) throw new Error(`Unexpected field in PR payload: ${key}`);
  }
  for (const key of REQUIRED_PAYLOAD_FIELDS) {
    if (typeof data[key] !== 'string' || data[key].trim() === '') throw new Error(`Missing or blank PR payload field: ${key}`);
  }
  return { title: data.title, head: data.head, base: data.base, body: data.body };
}

export function isHeld(body) {
  for (const line of String(body ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    return trimmed.startsWith('**needs ');
  }
  return false;
}

export function missingSections(body, names) {
  const lines = String(body ?? '').split('\n');
  const headings = [];
  lines.forEach((line, index) => {
    if (line.startsWith('## ')) headings.push({ index, title: line.slice(3).trim() });
  });
  const missing = [];
  for (const name of names) {
    const at = headings.findIndex(heading => heading.title === name);
    if (at === -1) { missing.push(name); continue; }
    const end = at + 1 < headings.length ? headings[at + 1].index : lines.length;
    const content = lines.slice(headings[at].index + 1, end).join('\n');
    const withoutMarkers = content.replace(SWARM_MARKER_RE, '').trim();
    const markerMatches = content.match(SWARM_MARKER_RE);
    if (withoutMarkers === '' || markerMatches) missing.push(name);
  }
  return missing;
}

export function renderChecks(results) {
  const lines = [];
  for (const result of results) {
    let line = `${result.name} -> ${result.status}`;
    if (result.status === 'failed' && result.exitCode != null) line += ` (exit ${result.exitCode})`;
    lines.push(line);
    if (result.status === 'failed' && result.tail) lines.push(...String(result.tail).split('\n').slice(-20));
  }
  return ['```', ...lines, '```'].join('\n');
}

export function fillChecks(body, results) {
  const text = String(body ?? '');
  if (!text.includes(CHECKS_PLACEHOLDER)) return text;
  return text.split(CHECKS_PLACEHOLDER).join(renderChecks(results));
}

export function summarizeRollup(rollup) {
  const items = Array.isArray(rollup) ? rollup : [];
  let pending = 0;
  let passed = 0;
  const failed = [];
  for (const item of items) {
    const name = item.name ?? item.context ?? 'unknown';
    if ('state' in item) {
      if (item.state === 'SUCCESS') passed += 1;
      else if (PENDING_STATES.has(item.state)) pending += 1;
      else failed.push(name);
    } else {
      if (item.status !== 'COMPLETED') { pending += 1; continue; }
      if (PASSING_CONCLUSIONS.has(item.conclusion)) passed += 1;
      else failed.push(name);
    }
  }
  return { total: items.length, pending, failed, passed };
}

export async function ship(options) {
  const {
    root, repo, payloadPath,
    requireSections = [],
    merge = true,
    mergeMethod = SHIP_DEFAULTS.mergeMethod,
    pollMs = SHIP_DEFAULTS.pollMs,
    timeoutMs = SHIP_DEFAULTS.timeoutMs,
    noCiGraceMs = SHIP_DEFAULTS.noCiGraceMs,
    runChecks, exec, sleep, now = () => Date.now(),
  } = options;

  const base = { status: null, repo, pr: null, url: null, sha: null, mergeSha: null, checks: null, ci: null, reason: null };

  if (!VALID_MERGE_METHODS.has(mergeMethod)) return { ...base, status: 'refused', reason: 'invalid merge method' };
  for (const [name, value] of [['pollMs', pollMs], ['timeoutMs', timeoutMs], ['noCiGraceMs', noCiGraceMs]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return { ...base, status: 'refused', reason: `invalid ${name}` };
  }

  let payload;
  try {
    payload = parsePrPayload(await fs.readFile(payloadPath, 'utf8'));
  } catch (err) {
    return { ...base, status: 'refused', reason: err.message };
  }
  if (!REPO_RE.test(repo)) return { ...base, status: 'refused', reason: 'invalid repo' };
  if (!HEAD_RE.test(payload.head) || payload.head.startsWith('-')) return { ...base, status: 'refused', reason: 'invalid head' };

  const statusRes = await exec('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root });
  if (statusRes.code !== 0) return { ...base, status: 'refused', reason: 'git status failed' };
  if (statusRes.stdout.trim() !== '') return { ...base, status: 'refused', reason: 'commit first' };
  const shaRes = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  if (shaRes.code !== 0 || shaRes.stdout.trim() === '') return { ...base, status: 'refused', reason: stepFailed('rev-parse', shaRes) };
  const sha = shaRes.stdout.trim();
  base.sha = sha;

  const checks = await runChecks();
  base.checks = checks;
  const body = fillChecks(payload.body, checks);
  if (checks.some(result => result.status === 'failed')) return { ...base, status: 'checks-failed', reason: 'checks failed' };

  const missing = missingSections(body, requireSections);
  if (missing.length > 0) {
    const reasons = missing.map(section => {
      const marker = getMarkerForSection(body, section);
      return marker ? `${section} (leftover: ${marker})` : section;
    });
    return { ...base, status: 'refused', reason: `missing sections: ${reasons.join(', ')}` };
  }

  const pushRes = await exec('git', ['push', 'origin', `HEAD:refs/heads/${payload.head}`], { cwd: root });
  if (pushRes.code !== 0) return { ...base, status: 'refused', reason: stepFailed('push', pushRes) };

  const [owner] = repo.split('/');
  const listRes = await exec('gh', ['api', `repos/${repo}/pulls?head=${owner}:${payload.head}&state=open`], { cwd: root });
  let existing;
  if (listRes.code !== 0) return { ...base, status: 'refused', reason: stepFailed('pr list', listRes) };
  try {
    existing = JSON.parse(listRes.stdout || '[]');
  } catch {
    return { ...base, status: 'refused', reason: stepFailed('pr list', listRes) };
  }
  let pr;
  if (existing.length > 0) {
    const patchRes = await exec('gh', ['api', '-X', 'PATCH', `repos/${repo}/pulls/${existing[0].number}`, '--input', '-'], {
      cwd: root, input: JSON.stringify({ title: payload.title, body }),
    });
    if (patchRes.code !== 0) return { ...base, status: 'refused', reason: stepFailed('pr update', patchRes) };
    try {
      pr = JSON.parse(patchRes.stdout);
    } catch {
      return { ...base, status: 'refused', reason: stepFailed('pr update', patchRes) };
    }
  } else {
    const createRes = await exec('gh', ['api', `repos/${repo}/pulls`, '--input', '-'], {
      cwd: root, input: JSON.stringify({ title: payload.title, head: payload.head, base: payload.base, body }),
    });
    if (createRes.code !== 0) return { ...base, status: 'refused', reason: stepFailed('pr create', createRes) };
    try {
      pr = JSON.parse(createRes.stdout);
    } catch {
      return { ...base, status: 'refused', reason: stepFailed('pr create', createRes) };
    }
  }
  base.pr = pr.number;
  base.url = pr.html_url;

  const start = now();
  let ci = null;
  for (;;) {
    const viewRes = await exec('gh', ['pr', 'view', String(pr.number), '--repo', repo, '--json', 'state,headRefOid,mergeStateStatus,statusCheckRollup'], { cwd: root });
    let view = null;
    if (viewRes.code === 0) {
      try {
        view = JSON.parse(viewRes.stdout);
      } catch {
        view = null;
      }
    }
    if (view) {
      const summary = summarizeRollup(view.statusCheckRollup);
      const headMatches = view.headRefOid === sha;
      if (headMatches && summary.total > 0 && summary.pending === 0) { ci = summary; break; }
      const elapsed = now() - start;
      if (headMatches && summary.total === 0 && elapsed >= noCiGraceMs) return { ...base, status: 'no-ci', reason: 'no CI detected', ci: summary };
      if (elapsed >= timeoutMs) return { ...base, status: 'timeout', reason: 'timed out waiting for checks', ci: summary };
    } else if (now() - start >= timeoutMs) {
      return { ...base, status: 'timeout', reason: 'timed out waiting for checks', ci: null };
    }
    await sleep(pollMs);
  }
  base.ci = ci;
  if (ci.failed.length > 0) return { ...base, status: 'ci-failed', reason: `failed checks: ${ci.failed.join(', ')}` };

  if (isHeld(body)) return { ...base, status: 'held', reason: 'PR body requests manual review' };
  if (merge === false) return { ...base, status: 'ready' };

  const mergeRes = await exec('gh', ['pr', 'merge', String(pr.number), '--repo', repo, `--${mergeMethod}`, '--match-head-commit', sha], { cwd: root });
  if (mergeRes.code !== 0) return { ...base, status: 'merge-failed', reason: firstStderrLine(mergeRes.stderr) };
  const mergedRes = await exec('gh', ['pr', 'view', String(pr.number), '--repo', repo, '--json', 'state,mergeCommit'], { cwd: root });
  let merged = null;
  if (mergedRes.code === 0) {
    try {
      merged = JSON.parse(mergedRes.stdout);
    } catch {
      merged = null;
    }
  }
  if (!merged) return { ...base, status: 'merge-failed', reason: stepFailed('post-merge view', mergedRes) };
  if (merged.state === 'MERGED') return { ...base, status: 'merged', mergeSha: merged.mergeCommit?.oid ?? null };
  return { ...base, status: 'merge-failed', reason: 'PR not merged' };
}
