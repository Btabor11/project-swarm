# Changelog

## Unreleased

- Require an explicit non-empty `model` on every job, CLI or API: `validateManifest` now refuses a job with no `model` (`Job <id> requires an explicit model; the runner never uses a CLI default`), so Claude jobs can no longer silently fall back to the user's own installed CLI default model.
- Add `monitor <run-id> --view` (a dependency-free human table: id/agent/model/tier/status/elapsed/output count, a running·done·failed·queued summary, and per-provider usage) and `--watch [seconds]` to redraw it in place until the run finishes; the default JSON `monitor` output is unchanged.
- Replace topic-based routing checklist with difficulty-based rule: route by how hard the work is, not what topics it involves. `cheap` covers small follow-ups and bookkeeping regardless of domain; `mid` covers ordinary code and tests; `expensive` covers genuinely hard work or escalations after two mid-tier failures.
- Add an optional per-job `tier` (`cheap`/`mid`/`expensive`) and `tierReason` manifest field so model routing is a written, reviewable decision instead of gut feel. `expensive` requires a non-empty `tierReason`; an explicit `model` always wins over `tier`; a manifest with no `tier` behaves exactly as before. `tier` is validated metadata, surfaced in `preflight` and `inspect` output, and does not itself select a model. Document the routing guidance in the skill and orchestration guide; the failed-twice escalation is a coordinator rule, since the runner has no retry/re-dispatch path to hook it into.
- Check decoded API output strings for echoed provider keys before saving summaries, files, or metadata, including JSON-escaped echoes.
- Give every Lambda request a fresh routing-session nonce, including repeated runs with the same job ID in one process.
- Add preflight context breakdowns, snapshot-dependency warnings, and task-sizing advisories.
- Teach coordinators to split independent deliverables, use small integration batches, and preserve one writer per file.
- Add content-free live CLI output telemetry with explicit non-streaming API limitations.
- Document a real parallel connector/village build, measured integration waiting, and validation limits.
- Include new runtime modules and regression suites in the installer.

## 1.2.1

- Add a `lambda` adapter: one OpenAI-compatible chat-completions request with a strict JSON schema and no tools, against hosted Lambda Inference or an operator-owned `SWARM_LAMBDA_URL` origin under the existing origin rules.
- Reject Lambda responses that are truncated, refused, tool-calling, or absent, and keep `LAMBDA_API_KEY` out of logs and saved outputs.
- Package validation uses mocked transport; hosted Lambda access remains unverified. The contributor reports a separate self-hosted vLLM exercise; this is not a guarantee of another account or model.
- Increase startup headroom in two timeout tests without weakening their assertions.
- Keep fresh checkouts on LF and accept existing CRLF skill frontmatter in package checks.
- Anonymize the public website case study and remove customer-specific implementation details.
- Refresh provider discovery and document safe public contributions.


## 1.2.0

- Add restricted Hermes and Qwen Code CLI adapters with copied text and validated complete-file JSON output. Reject tool activity, malformed/duplicate results, and unsuccessful exits.
- Increase opt-in concurrency to 32 and queue capacity to 256; default concurrency remains 2.
- Clean owned process groups after normal exits, errors, cancellation, and timeouts, including inherited-open streams. Surface signal permission failures instead of claiming successful cleanup. Escaped groups remain outside scope.
- Show job status in inspection and block incomplete jobs, with explicit whole-run conflict recovery guidance.
- Persist the actual serialized Hermes/Qwen prompt and schema for review.
- Record queue/start/finish times, durations, observed peak activity, per-provider numeric usage, and concise `monitor` snapshots.
- Add active orchestration guidance, bounded CLI smoke recipes, parser/compatibility tests, and installed runtime support.
- CLI compatibility and authenticated live verification remain separate. New adapters are mock-process tested; live account access is not claimed.


## 1.1.0

- Add OpenAI Responses, Gemini generateContent, and local/explicit HTTPS Ollama adapters without npm dependencies.
- Share copied context, exact output ownership, review, and conflict-checked integration across providers.
- Validate structured complete-file responses; reject binary context, unexpected outputs, refusals, truncation, and oversized responses.
- Bound HTTP lifetimes, refuse redirects, omit raw HTTP errors/headers, and preserve credentials outside logs.
- Add provider configuration reports, mixed-provider recipes, API smoke templates, and complete installation of adapter runtime/tests.
- Raise opt-in concurrency to 16 while preserving the default 2. Test four active requests/processes and queued-job cancellation.
- API contract tests are deterministic mocks; live API account/model support is not claimed.


## 1.0.0

First standalone package extracted from the example website project's local orchestration tools.

- Fresh Claude Code workers with explicit model selection and concurrency from one to three.
- Explicit input/output manifests, copied workspaces, bounded runtime and logs, and local run records.
- Saved responses with provider metadata when available, status inspection, and cancellation of owned workers.
- Conflict-checked integration of declared outputs, with file-mode preservation and no deletion propagation.
- Local prerequisite diagnostics, manifest validation, and proposed-change inspection.
- An explicit target-project root option and an installer that refuses destination overwrites.
- A reusable orchestration skill, smoke and parallel-review examples, deterministic tests, and setup and extension guides.
- A factual website case study distinguishing direct CLI implementation from reusable-runner smoke and review jobs.
- Apache License 2.0.

In 1.0.0, the supported adapter was Claude Code only. Copied workspaces are not an OS security sandbox; Windows support is not claimed.
