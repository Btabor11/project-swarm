// SPDX-License-Identifier: Apache-2.0
// Advisory task sizing. This module neither starts workers nor changes a manifest.
import { validateManifest, validateProject } from './swarm.mjs';

export const PREFLIGHT_THRESHOLDS = Object.freeze({ outputs: 5, contextBytes: 160 * 1024 });
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export async function preflightProject(root, manifest) {
  validateManifest(manifest);
  // Use the same guarded reads as execution. Do not follow validation with a
  // second, unguarded filesystem walk merely to gather size information.
  const validated = await validateProject(root, manifest);
  const advisories = [];
  const copies = new Map();
  const jobs = validated.jobs.map((checked, index) => {
    const job = manifest.jobs[index];
    if (!Array.isArray(checked.files)) throw new Error('Preflight requires file metadata from validateProject');
    const files = checked.files.map(file => ({ ...file })).sort(byPath);
    for (const file of files.filter(file => file.exists)) {
      const entry = copies.get(file.path) ?? { path: file.path, jobs: [], copiedBytes: 0 };
      entry.jobs.push({ id: job.id, bytes: file.bytes, context: file.context, output: file.output });
      entry.copiedBytes += file.bytes;
      copies.set(file.path, entry);
    }
    if (job.outputs.length > PREFLIGHT_THRESHOLDS.outputs) advisories.push({
      code: 'review-output-scope', jobId: job.id, actual: job.outputs.length, threshold: PREFLIGHT_THRESHOLDS.outputs,
      message: 'Review whether these outputs span independent concerns. Split coherent deliverables with separate writers; keep coupled files together.',
    });
    if (checked.contextBytes > PREFLIGHT_THRESHOLDS.contextBytes) advisories.push({
      code: 'review-context-size', jobId: job.id, actual: checked.contextBytes, threshold: PREFLIGHT_THRESHOLDS.contextBytes,
      message: 'Review the largest copied files and provide only context needed for the acceptance check. Size is a review signal, not proof that the task is too large.',
    });
    return {
      // tier/tierReason are validated routing metadata for the coordinator; they are
      // advisory only here and never change which model or provider actually runs.
      id: job.id, agent: job.agent, model: job.model ?? null, tier: job.tier ?? null, tierReason: job.tierReason ?? null,
      outputCount: job.outputs.length, contextBytes: checked.contextBytes,
      files, largestContexts: files.filter(file => file.exists).sort((a, b) => b.bytes - a.bytes || byPath(a, b)).slice(0, 5),
    };
  });

  const writers = new Map(manifest.jobs.flatMap(job => job.outputs.map(file => [file.toLowerCase(), { jobId: job.id, path: file }])));
  const snapshotHazards = [];
  for (const job of manifest.jobs) {
    for (const file of job.context) {
      const writer = writers.get(file.toLowerCase());
      if (writer && writer.jobId !== job.id) snapshotHazards.push({
        path: file, writerJobId: writer.jobId, readerJobId: job.id,
        message: 'The reader receives the pre-run snapshot, not this writer’s output. Agree on an exact stable contract or move the reader to a later run after integration; concurrency 1 does not establish a dependency.',
      });
    }
  }
  const repeatedContext = [...copies.values()].filter(entry => entry.jobs.length > 1).sort(byPath).map(entry => ({
    ...entry,
    repeatedBytes: entry.copiedBytes - Math.max(...entry.jobs.map(job => job.bytes)),
  }));
  return {
    status: 'preflight', validated: true, advisoryOnly: true,
    concurrency: manifest.concurrency ?? 2, jobCount: jobs.length,
    totalContextBytes: jobs.reduce((sum, job) => sum + job.contextBytes, 0),
    thresholds: { ...PREFLIGHT_THRESHOLDS }, jobs, repeatedContext, snapshotHazards, advisories,
    reviewRequired: advisories.length > 0 || snapshotHazards.length > 0,
    limitations: [
      'Output counts and byte thresholds do not measure semantic complexity, model tokens, speedup, or useful worker capacity.',
      'Repeated context may be necessary for correctness. Files include existing outputs because workers receive those snapshots too.',
      'This report covers one manifest at one moment. It does not reserve files, detect other active runs, or make dependencies execute in order.',
      'No source contents, prompt text, provider calls, automatic splitting, or worker dispatch are included in this report.',
    ],
  };
}
