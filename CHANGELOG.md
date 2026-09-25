# Changelog

## Unreleased

## 1.10.1

- `inspect --results`, `wait` and `ask` read a worker's final JSON even when it is wrapped in backticks or pretty-printed in a ```json fence (the last fenced object wins); plain final lines work as before.
- `validate`/`run` in a non-git root no longer print git's `fatal: not a git repository` to stderr (the context check's `git ls-files` fallback is now quiet).

## 1.10.0

- Add `swarm board`: a per-user registry of live runs across worktrees (`~/.project-swarm/live`, override with `SWARM_LIVE_DIR`). `run`/`go` now refuse to start a second writer on a file another live run already owns in the same repository (across worktrees), with no override. See [the manifest reference](docs/manifest-reference.md#board).
- Add a job `after` field: an optional list of other job ids in the same manifest that must all reach `complete` before the job starts; a dependent job's workspace receives its dependencies' changed outputs as read-only context. Not yet supported for `codex` jobs. See [the manifest reference](docs/manifest-reference.md#after).
- `checks` entries gain an optional `repeat` (1–20, default 1), running the check's argv up to that many times and stopping at the first failure; add `{new}`/`{new:.ext}` placeholders that expand to integrated files that did not exist before the run started. See [the manifest reference](docs/manifest-reference.md#repeat).
- A manifest's `contract` file is now injected into the codex prompt itself (a "Shared contract" section, read first) instead of only being required in `context`.
- `wait`/`inspect`/`inspect --results` job entries gain `tokens`; the run level gains `tokens` (summed) and `costNotReported` (job ids with no reported cost).

## 1.9.0

- Add `go <manifest.json|run-id> [--commit-message MSG] [--repo OWNER/NAME --pr payload.json] [--require-section NAME]... [--mutants] [--merge-method M] [--timeout S]`: one command from a manifest (or an already-started run) to a merged, reviewed change. It runs `validate`+`run`+`wait` (skipped when given a run id), `integrate` with checks (and mutants when `--mutants` is set or the manifest declares them), stages and commits exactly that run's integrated output files with `git add --` (never `git add -A`) when `--commit-message` is given, then `ship` when `--repo`/`--pr` are given. It prints one JSON line, `{status,stage,runId,cost,warnings,integrate,ship,reason}`, and exits `0` for `merged`/`held`/`ready`/`integrated`/`committed`, `1` for `failed`. See [the manifest reference](docs/manifest-reference.md#go).
- `checks` and `mutantCheck` argv items may now contain `{root}` anywhere inside the item (e.g. `"CARGO_TARGET_DIR={root}/src-tauri/target"`), which expands to the run's absolute project root, so parallel runs never share a build/output folder; `{integrated}`/`{integrated:.ext}` behavior is unchanged.
- Installs are now versioned: `install` snapshots the runtime into `<source>/versions/<version>-<hash8>/` and atomically repoints a `current` symlink at it, so a run already in flight keeps importing its own version dir even after a later install replaces `tools/` underneath it; the 5 newest version dirs are kept and `current`'s target is never deleted. `.swarm-install.json` records `versionDir` and `runner`, and installed skill files resolve `{{SWARM_RUNNER}}` to `<source>/current/tools/swarm.mjs`.
- Run through `current/`, commands with no `--root` (`version`, `update`, self-hosted runs) still target the install checkout, not the `versions/` snapshot; `go` stops at integrate on any surviving mutant, including a manifest's own mutants run without `--mutants`.

## 1.8.0

- `ship --require-section` treats any leftover `<!-- swarm:<name> -->` marker (other than `<!-- swarm:checks -->`, which ship fills itself) as unfilled.
- Job records gain `actualModel` (the model behind most `assistant` events, falling back to the init model then `null`), `modelsSeen` (distinct model ids observed, in first-seen order), and `modelMismatch` (true when an assistant-event model does not match the requested model); `wait` and `inspect` surface each mismatch in a top-level `warnings` array without failing the job.
- Add `swarm ask --model M --context f1,f2,... "question"`, a single read-only job run to completion that prints one JSON line with the worker's parsed result; add `inspect <run-id> --results` to print just `{runId,status,warnings,jobs}` with each job's `result`.
- A codex job whose process exits 0 but whose final envelope fails validation now keeps its worktree, fails the job with `keptWorkspace: <path>`, and `validate` warns when its prompt asks for extra top-level JSON keys beyond `files_changed`/`notes`.
- Context check no longer flags a test's reference to `package.json`, `package-lock.json`, `pyproject.toml`, `uv.lock`, `Cargo.toml`, `Cargo.lock`, or any `__init__.py`; the refusal JSON adds `suggestedIgnoreTests` listing the uncovered tests per job.
- Read-only jobs (`outputs: []`) start the Claude CLI with `--permission-mode default` instead of `plan`, which had silently run a different model than requested.
- Document `ask`, `inspect --results`, the model-mismatch warning, and `suggestedIgnoreTests` in the skill, README, and manifest reference; fix the skill's adapter count.

## 1.7.0

- Add `ship <run-id> --repo OWNER/NAME --pr payload.json`: push an integrated run's branch, open or update its pull request, re-run the manifest's `checks` and fill them into the PR body, wait for CI, and merge once green; refuses on a dirty tree, a failed check, a missing required `--require-section`, or a rejected push, and never merges a PR body opening with a `**needs ` human-review marker. Add a job `ignoreTests` field and a top-level manifest `contract` field: `validate`/`run` now refuse a job whose existing declared output is referenced by a project test missing from its `context`/`outputs`/`ignoreTests`, and, when `contract` names a shared file, refuse any job whose `context` omits it or whose `outputs` includes it (1.7.0)

## 1.6.0

- `wait`, `inspect` shows worker notes and cost, `validate` refuses untracked codex context, `integrate --mutants` mutation checks; CI actions SHA-pinned (1.6.0)

## 1.5.1

- Repository moved to `RDW-Labz/project-swarm`: `package.json` `repository.url`, README and setup clone URLs updated (1.5.1)

## 1.5.0

- One shared install per machine, agent-readable install steps, onboard/version/update commands (1.5.0)

## 1.4.0

- Add a sandboxed `codex` worker agent (Codex CLI in a per-job git worktree, macOS seatbelt; 1.4.0)
- Disable chat-template thinking on self-hosted Lambda origins, where a reasoning model behind the strict JSON envelope spends its whole output allowance on reasoning and returns no content; `SWARM_LAMBDA_THINKING=on` opts back in, and hosted Lambda Inference is unchanged.

## 1.3.0

- integrate runs manifest checks (format, tests) right after writing files (1.3.0)
- Fix `doctor` false-negative "lacks required flags" against Claude CLI 2.1.280+: its `--help` output can exit before the stdout pipe drains, truncating a piped read. `doctor` and `extraCliDoctor` now read CLI help through a shared temp-file-backed runner (`execViaFile`, the new default for the injectable `exec`), retry once if flags look missing, and report a distinct "help probe failed (no or empty output)" error when the read itself is empty rather than misreporting missing flags.
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
