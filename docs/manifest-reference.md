# Manifest reference

A manifest is a JSON object with `version`, `jobs`, and optional `concurrency`. It contains task data, not shell commands or provider configuration.

```json
{
  "version": 1,
  "concurrency": 2,
  "jobs": [
    {
      "id": "review-rendering",
      "agent": "claude",
      "model": "sonnet",
      "prompt": "Review the copied renderer for concrete performance issues. Write a concise report. Distinguish measured facts from hypotheses; do not claim to have run tests.",
      "context": ["src/renderer.js"],
      "outputs": ["reviews/rendering.md"],
      "timeoutMs": 300000
    }
  ]
}
```

Replace the example paths with files in your target project.

## Top-level fields

- `version`: required, exactly `1`.
- `jobs`: required array of 1–256 jobs.
- `concurrency`: optional integer from 1 to 32; default is 2. The effective parallelism is never greater than the number of jobs.
- `checks`: optional array of at most 10 post-integration checks, run by `integrate` after it writes files. See the Checks section below.
- `mutants`: optional array of at most 32 mutation entries, checked by `integrate --mutants`. See the Mutation checks section below.
- `mutantCheck`: optional, the single check run against each mutant in `mutants`. See the Mutation checks section below.
- `contract`: optional explicit existing relative file path. When set, every job's `context` must include it and no job's `outputs` may include it — only the coordinator writes it. Use this for a single file that lists every cross-job event, command, export, and field parallel jobs need to agree on; a job that needs a name not in that file should surface it rather than invent one silently. For a `codex` job, its current bytes are also injected directly into the prompt (a "Shared contract" section, read first, wins over any other file); with no `contract`, the codex prompt is unchanged. See "Shared contract" in [workflows](workflows.md).

Unknown top-level fields are rejected.

## Job fields

- `id`: required unique string, 1–80 characters. The first character is an ASCII letter or digit; remaining characters may also include `_` and `-`.
- `agent`: required: `"claude"`, `"codex"`, `"hermes"`, `"qwen"`, `"openai"`, `"gemini"`, `"ollama"`, or `"lambda"`.
- `model`: required non-empty model identifier or alias, for every job on every agent. The runner never falls back to a CLI default — for Claude, that default is the user's own, often most expensive, configured model — so an omitted `model` is refused before any worker starts. The first character is an ASCII letter or digit; remaining characters may also include `.`, `_`, `:`, `/`, and `-`. Maximum length is 120 characters. Codex instead requires `/^[A-Za-z0-9._:-]{1,80}$/` and always passes `-m <job.model>`. Syntax validation does not prove provider availability.
- `prompt`: required nonblank string of at most 100,000 characters. Include the task, expected output, and relevant acceptance criteria.
- `context`: required array of explicit existing relative file paths, at most 100 entries. These files are copied for other workers; Codex receives them as a read-first list in its HEAD worktree.
- `outputs`: required array of explicit relative file paths, at most 100 entries. Existing files are copied automatically; new files may be created. An empty array creates a job with no proposed files; Codex still has shell access inside its sandbox.
- `readPaths`: optional for `codex` only, an array of at most 100 absolute read-only paths for extra toolchains. Quotes, backslashes, and control characters are refused. Paths under `~/.oasis`, `~/Library/Keychains`, `~/.ssh`, `~/.aws`, or `~/.config` are refused, including resolved aliases. Final sandbox denies override grants.
- `maxOutputTokens`: optional for API jobs only, integer 256–32768, default 8192. This is an output limit, not a dollar budget; reasoning may consume the allowance.
- `timeoutMs`: optional integer from 50 to 3,600,000 milliseconds. Default is 300,000 milliseconds, or five minutes.
- `tier`: optional, one of `"cheap"`, `"mid"`, or `"expensive"`. A named routing decision for the coordinator, not a model catalog lookup: setting `tier` never chooses, overrides, or resolves a model. It is validated metadata, shown in `preflight` and `inspect` output for review. See [the routing checklist](orchestration.md) for when to use each value.
- `tierReason`: optional string, at most 2,000 characters. Required, and must be non-empty after trimming, whenever `tier` is `"expensive"`; the reason is what makes the choice inspectable instead of gut feel. Optional for `"cheap"`/`"mid"`.
- `ignoreTests`: optional array of at most 100 explicit existing relative file paths, same path rules as `context`. Lists test files the job knowingly leaves uncovered by `context` — see "Context check" below. Give a reason in the `prompt` when you use it.
- `after`: optional non-empty array of other job ids in the same manifest that must all reach `complete` before this job starts. See [After](#after) below.

**Precedence:** an explicit per-job `model` always wins. `tier` is descriptive, coordinator-facing routing guidance for choosing which provider/model to put in `model` (or which worker pool to dispatch to); the runner itself does not map `tier` to a model. A job may set both: `model` decides what actually runs, `tier`/`tierReason` document why that choice was made. A manifest with no `tier` field behaves exactly as before.

Unknown job fields are rejected. Manifests cannot specify executable paths, arbitrary provider commands, environment variables, shell scripts, MCP servers, or additional tools.

## File rules

Paths are relative to the selected project root. Use forward slashes. Do not use absolute paths, empty segments, `.` or `..` segments, backslashes, directories, or glob patterns. Symlinks are refused along the checked path.

`.git`, `.swarm`, `.env`, and names beginning `.env.` are reserved path segments. These checks do not recognize every possible secret filename: explicitly audit the contents you choose to copy.

Files must be regular files no larger than 16 MiB. Each job's combined copied files are limited to 32 MiB. A context file must already exist. An output may be new, including a new nested path. Duplicate entries within either array are rejected; a path may appear in both `context` and `outputs` when a worker needs to edit a file it reads.

Each output has exactly one writer per manifest. Output collisions and overlapping file/directory output paths are rejected. There is no automatic handoff of one worker's new output to another worker in the same run.

Claude read-only jobs receive `Read`, `Glob`, and `Grep`. Writing jobs additionally receive `Write` and `Edit`. These restricted adapters do not receive shell, network, delegation, or MCP tools. Codex uses a separate macOS OS sandbox and a full detached HEAD worktree, with shell access for tests; see [Codex setup and file grants](providers.md). API jobs have no tools; the runner sends only copied UTF-8 text without NUL bytes in one request and validates an exact output-file envelope before writing the copy. Cloud providers require network access; Ollama defaults to localhost.

## After

A job's optional `after` field names other job ids in the same manifest that must all reach `complete` before it starts. `validate`/`run` refuse an unknown id (`Job <id> after names unknown job <x>`), a job naming itself, duplicate ids, a cycle (`after cycle: a -> b -> a`), and `after` on a `codex` job (`after is not supported for codex jobs yet`).

A job with no `after` starts exactly as before. A job that does have `after` starts only once every job it names has status `complete`; if any of them instead ends `failed`, `timeout`, or `cancelled`, the dependent job is never started — it gets `status: "skipped"` and `error: "after <id> <status>"`. Concurrency still caps how many jobs run at once. When a dependent job starts, each output its dependencies changed is copied into its workspace and added to its own context, read-only; a dependency's output can never also appear in a dependent's `outputs` — the existing one-writer-per-file rule already refuses that. `integrate` still applies jobs in manifest order; a run containing a `skipped` job is never `status: "complete"`.

## Board

`node tools/swarm.mjs board` prints `{"runs": [{"runId", "root", "repo", "pid", "startedAt", "status", "jobs": [{"id", "status", "outputs"}]}]}`, a read-only snapshot of every live run this machine's user is tracking across every worktree of every repository — not just the current project. It reads a per-user registry under `~/.project-swarm/live` (override with the `SWARM_LIVE_DIR` environment variable); each run there is a small JSON record keyed by the project's shared git directory, so two worktrees of the same repository are recognized as the same project even though their working directories differ. A record whose process is no longer alive is pruned automatically before the summary is built. Each run's `status`/`jobs` come from that run's own saved `.swarm/runs/<run-id>/state.json`; `status` is `"unknown"` and `jobs` is `[]` when that file cannot be read (for example, a run recorded on a since-removed worktree).

Before starting any job, `run` (and therefore `go`) checks this same registry for another live run in the same repository — across worktrees — already writing one of this run's declared outputs. If it finds one, it refuses to start with `Refusing to run: <file> is also written by live run <runId> in <root>`, naming the first conflicting file and run; every conflict is listed in the error's `details.conflicts`. Nothing is registered and no job starts. There is no override flag: resolve the conflict (wait for the other run, or change one manifest's outputs) and try again. Once a run is registered, it is unregistered when the run ends, whether it completes, fails, is cancelled, or the process itself throws.

## Commands

```sh
node tools/swarm.mjs doctor all
node tools/swarm.mjs doctor openai
node tools/swarm.mjs validate examples/smoke.json
node tools/swarm.mjs run examples/smoke.json
node tools/swarm.mjs ask --model sonnet --context src/a.js,src/b.js "question"
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs monitor <run-id>
node tools/swarm.mjs monitor <run-id> --view
node tools/swarm.mjs monitor <run-id> --view --watch 5
node tools/swarm.mjs wait <run-id>
node tools/swarm.mjs wait <run-id> --timeout 300
node tools/swarm.mjs inspect <run-id>
node tools/swarm.mjs inspect <run-id> --results
node tools/swarm.mjs integrate <run-id>
node tools/swarm.mjs integrate <run-id> --no-checks
node tools/swarm.mjs integrate <run-id> --require-checks
node tools/swarm.mjs integrate <run-id> --mutants
node tools/swarm.mjs cancel <run-id>
node tools/swarm.mjs board
node tools/swarm.mjs ship <run-id> --repo OWNER/NAME --pr payload.json
node tools/swarm.mjs ship <run-id> --repo OWNER/NAME --pr payload.json --require-section "Mutation check" --no-merge
node tools/swarm.mjs go examples/smoke.json --commit-message "Add render review" --repo OWNER/NAME --pr payload.json
```

Use `--root /path/to/project` to select a project explicitly. Otherwise the runner uses its own installed project root. Manifests are loaded from the selected root. Installs are versioned: `<source>/current/tools/swarm.mjs` is always the runner path, kept stable for a run already in flight even if a later install/update repoints `current` to a newer version underneath it.

`validate` checks the assignment, paths, file size limits, and (see "Context check" below) that every existing declared output is not left uncovered by a test that already references it, without creating a run or invoking a model. For Codex, both validate and preflight warn about uncommitted changes to declared context/output files because only HEAD is checked out; a declared `context` file that git does not track at all (untracked or ignored, not merely edited) is instead refused outright — `Job <id>: codex context file <path> is not tracked by git (codex sees HEAD only)` — since Codex would silently see nothing there; the manifest's `contract` path is exempt from this refusal, since its text now travels in the codex prompt directly (see below). `run` performs the same validation before dispatching any worker. `doctor` diagnoses local prerequisites without running a model task. `status` reports saved run state. `inspect` reports each job's `agent`, `model`, `tier`, and `tierReason`, plus proposed-output sizes, owning `jobStatus`, and current conflicts without editing files. Its file `status` is `blocked` whenever the owning job is not complete, even if the worker left a partial file. Neither inspection nor validation approves content or runs application tests.

`inspect` additionally reports, per job, `result` — the worker's own final JSON-object line from its saved response (whatever keys it wrote, or `null` if no line parses as a JSON object) — and `costUsd` (a number when the provider reported one, else `null`). A `result.notes` array, if present, is capped at 20 entries of at most 500 characters each in the printed report; this is display data from the worker, never executed or trusted.

`wait`, `inspect`, and `inspect --results` job entries also carry `tokens` (`usage.total_tokens` when the provider reported it, else `null`). At the run level, `tokens` is the sum of every job's non-null `tokens` (or `null` when none are known), and `costNotReported` lists the ids of jobs whose `costUsd` is `null` (`[]` when every job reported a cost); the run's `costUsd` stays the sum of the costs that were reported.

Each job record also carries `actualModel` (the model behind most of its `assistant` events, falling back to the init-reported model, then `null`), `modelsSeen` (every distinct valid model id observed across init and assistant events, in first-seen order), and `modelMismatch` (`true` when an assistant-event model does not match the requested `model`, using alias matching: a requested `haiku`/`sonnet`/`opus`/`fable` matches any id containing that word, otherwise the id must equal or start with the request). Both plain `inspect` and `wait` add a top-level `warnings` array with one string per mismatched job, `model mismatch: <job id> asked <requested>, ran <actualModel>`; the job itself is not failed for it. Add `--results` to `inspect <run-id>` to print only `{"runId","status","warnings":[...],"jobs":[{"id","status","model","actualModel","modelMismatch","costUsd","result"}]}` and nothing else.

`wait <run-id> [--timeout SECONDS]` blocks, polling saved run status at most once a second, until the run reaches a terminal status (`complete`, `failed`, or `cancelled`); with no `--timeout` it waits indefinitely. It prints one compact JSON line, `{runId, status, durationMs, costUsd, tokens, costNotReported, warnings, jobs: [{id, status, costUsd, tokens, notes}]}`, where `costUsd` is the sum of the jobs' recorded provider costs when any are available, else `null`, `tokens` is the sum of the jobs' non-null `tokens` (else `null`), `costNotReported` lists the ids of jobs with no reported cost, `warnings` lists any model-mismatch strings (see above), and each job's `notes` come from the same final-JSON-line parsing as `inspect` (capped the same way). Exit code is `0` for `complete`, `1` for `failed`/`cancelled` (or an unknown run id), and `2` if `--timeout` expires first — in that case `status` in the printed line is still `running`.

## Ask

`ask --model M --context f1,f2,... [--agent claude] [--timeout S] "question"` builds one read-only job in memory — `id: ask-<timestamp>`, empty `outputs`, the given `context`, and the question plus a fixed suffix asking for one final JSON line — runs it like `run`, waits for it, and prints exactly one JSON line: `{"id","status","model","actualModel","modelMismatch","costUsd","result"}`, where `result` is the worker's parsed final JSON (or `null` plus `error`). It refuses with no `--model`, no `--context`, or an empty question. Exit code is `0` when the job completes, `1` otherwise. `--agent` defaults to `claude`; only `claude` and API agents are allowed, never `codex`. The run is saved under `.swarm/runs/` like any other run.

```sh
node tools/swarm.mjs ask --model haiku --context src/renderer.js "Any obvious performance bug here?"
```

After installing into a project, use `coordination/swarm-smoke.json` and `coordination/swarm-parallel-review.json` in place of the standalone checkout's `examples/` paths. `--root` may appear before or after the command.

## Saved records

Each run uses these project-local locations:

```text
.swarm/
  runs/<run-id>/
    worktrees/<codex-job-id>/  # temporary detached HEAD checkout, removed after job
    manifest.json
    state.json
    <job-id>/
      message.txt
      response.txt
      provider.jsonl
      stderr.log
  workspaces/<run-id>/<job-id>/
    ...explicitly copied files and proposed outputs
```

The exact prompt, model response, and provider events are local evidence, not material to publish automatically. Provider metadata may contain usage and actual model identifiers when the provider emits them. API records contain a normalized event, numeric usage, and model identifier rather than raw HTTP responses or headers. API cost is unavailable, not inferred. Missing metadata must be reported as unavailable, not inferred from a requested alias.

An overall successful run has `status: "complete"`; individual jobs may instead fail, time out, or be cancelled. For Claude, a zero subprocess exit code alone is insufficient: the runner requires a successful provider result event and rejects malformed output, missing results, and reported permission denials.

## Integration contract

Integration requires a complete run from the same project, a matching saved manifest and worker record, and all declared output files. It validates every candidate and original target hash before writing any project output. If any target changed after the snapshot, integration stops with a conflict. It does not merge textual conflicts, propagate deletions, or import undeclared files.

An integration lock serializes integrations through this runner. Individual file replacements are atomic, with best-effort rollback on a caught write failure. This is not a transactional filesystem or protection against an unrelated process editing files concurrently. Keep a single coordinator for project writes and use normal version control.

API jobs additionally require a complete, non-refused response and valid JSON with exactly `summary` and `files`. Each file contains only `path` and complete `content`; every declared output must occur exactly once. Responses are capped at 16 MiB, redirects are refused, and partial/truncated output is never integrated. Provider credentials/endpoints cannot appear as manifest configuration. See [provider setup](providers.md).

The `monitor` command is a single read-only snapshot, suitable for periodic coordinator polling. New runs record `queuedAt`, `startedAt`, `finishedAt`, `durationMs`, configured concurrency, and observed peak active jobs. Counts reflect recorded queue state, not proof that stale processes survived a coordinator crash. Numeric usage is grouped by provider without combining incompatible token fields or estimating missing costs. Older run records remain readable; unavailable historical timings remain null.

`monitor <run-id>` still prints the JSON snapshot above by default; nothing about that output changed. Add `--view` for a human table instead: one row per job (`id`, `agent`, `model`, `tier`, `status`, elapsed/duration, declared output count), a summary line (running/done/failed/queued counts, total elapsed, peak concurrency), and, where recorded, usage per provider. Every status shows a symbol and a word together, never color alone, and color is used only on a TTY with `NO_COLOR` unset. Add `--watch [seconds]` (default 2) to keep `--view` re-rendering in place until the run reaches a terminal status or you press Ctrl+C; it only reads saved state and never starts, cancels, or integrates anything.

## Checks

`integrate <run-id>` runs the manifest's `checks` in declared order immediately after it writes the integrated files, so format drift and failing tests surface in the same command instead of costing the coordinator a separate job. Each check is `{"name": "...", "argv": ["...", ...], "timeoutMs": 300000}`:

```json
{
  "checks": [
    {"name": "format", "argv": ["uv", "run", "ruff", "format", "{integrated:.py}"]},
    {"name": "pytest", "argv": ["uv", "run", "pytest", "-q"], "timeoutMs": 600000}
  ]
}
```

- `name`: required, 1–60 characters from letters, digits, spaces, `.`, `_`, `-`.
- `argv`: required non-empty array of strings. `argv[0]` is the program; no shell is ever used, so shell metacharacters in any item are passed through literally, never interpreted.
- `timeoutMs`: optional integer 1,000–1,800,000; default 300,000.
- `repeat`: optional integer 1–20, default 1. See [Repeat](#repeat) below.

Up to 10 checks per manifest. Inside `argv`, a whole item of exactly `{integrated}` expands to the run's integrated file paths (relative to the project root) as separate argv items; `{integrated:.py}` (or any other extension) expands to only the integrated files with that extension. If a placeholder expands to zero files, that check is skipped (`status: "skipped"`) rather than run with nothing to act on.

The text `{root}` may also appear anywhere inside a `checks` or `mutantCheck` argv item — not only as a whole item — and is replaced with the run's absolute project root, for example `"CARGO_TARGET_DIR={root}/src-tauri/target"`. This keeps a project-relative build directory unique per run so two parallel runs never share (and corrupt) the same build folder. `{integrated}`/`{integrated:.ext}` still only expand a whole item, unchanged.

Checks run with `cwd` at the project root, the coordinator's inherited environment, and each check's own timeout; a later check still runs even if an earlier one fails, so a formatter can run before the tests that depend on its output. **Formatters may rewrite the files integration just wrote, and a failing check never rolls back the integration** — checks are reported, not a transactional gate. `integrate`'s own process exit code stays 0 when files integrate successfully regardless of check outcome; pass `--require-checks` to exit 1 when any check fails, times out, or errors. Pass `--no-checks` to skip them entirely (the result shows `checks: []` and `checksSkipped: true`).

## Repeat

A check is opt-in flaky-repro tooling: set `repeat` (1–20, default 1) to run its argv up to that many times, stopping at the first failure instead of running the remaining repeats. The result gains `runs` (how many times it actually ran) and, only on failure, `failedRun` (the 1-based repeat number that failed); a check with no `repeat` behaves exactly as before, `runs: 1`.

Inside `argv`, a whole item of exactly `{new}` expands to integrated files that did not exist when the run started (the job's base hash recorded the file as absent); `{new:.ext}` restricts that to files with the given extension. Both follow the same skip rule as `{integrated}`: if the placeholder expands to zero files, the check is skipped (`status: "skipped"`) rather than run with nothing to act on.

The result (and the saved run state, visible from `inspect <run-id>`) gains:

```json
{
  "checks": [{"name": "format", "status": "passed", "exitCode": 0, "durationMs": 812, "tail": "..."}],
  "checksPassed": true
}
```

`status` is one of `passed`, `failed` (non-zero exit), `timeout`, `error` (the program could not be launched), or `skipped`. `tail` is the last 2000 bytes of that check's combined stdout+stderr, never more. `checksPassed` is `true` only when no check failed, timed out, or errored.

## Mutation checks

`integrate <run-id> --mutants` runs mutation testing after normal integration and its `checks` have already written and validated the real files. For each declared `mutants` entry, in order, it: reads the target file, requires `find` to occur in it exactly once, writes the file with `find` replaced by `replace`, runs the shared `mutantCheck` command, and then always restores the file's original bytes and mode — including when the check times out or fails to launch — before moving to the next mutant. A mutant is never applied unless `find` matched exactly once.

```json
{
  "mutants": [
    {"name": "off-by-one", "file": "src/limits.js", "find": "value <= max", "replace": "value < max"}
  ],
  "mutantCheck": {"argv": ["npm", "test"], "timeoutMs": 300000}
}
```

- `mutants`: optional array of at most 32 entries `{"name", "file", "find", "replace"}`. `name` is required, non-empty, and unique. `file` is a relative project path, validated with the same rules as a job output. `find` is a required non-empty string that must occur in `file` exactly once for the mutant to run. `replace` is a required string (it may be empty).
- `mutantCheck`: required whenever `--mutants` is used — `{"argv": [...], "timeoutMs": 300000}`, the same shape and limits as one entry in `checks` (no shell, no placeholders), run once per mutant with `cwd` at the project root.

The result gains `mutants: [{"name", "file", "status", "exitCode", "durationMs", "tail"}]` and `mutantsSummary: {"killed", "survived", "errors"}`. Per mutant, `status` is `killed` when the check exits non-zero, `survived` when it exits zero, or `error` for a timeout, a launch failure, a `find` match count other than one (`tail` explains why, e.g. `"find matched 0 times"`), or a missing file — none of these apply or run a check. `mutantsPassed` is `true` only when no mutant survived or errored. With `--require-checks`, a surviving or errored mutant also makes the `integrate` command exit 1, alongside a failed `checks` result. `--mutants` with no `mutants` declared in the manifest is a clear error, not a silent no-op. Mutants never touch `.git`/`.swarm` (the same path rules as every other declared file forbid it) and never run during `run` — only `integrate --mutants`.

## Context check

`validate` and `run` (which validates first) check, for every job, whether an already-existing declared output is referenced by a project test file that is not in that job's `context`, `outputs`, or `ignoreTests`. This catches a worker changing an output's behavior without ever seeing the test that asserts it. The check is advisory static text matching — a project file walk (or `git ls-files` in a git work tree) plus a regexp match against each candidate output's stem — not a dependency graph: it can miss an indirect reference and, rarely, flag a coincidental one. A reference from a test to a package manifest or version-only file — `package.json`, `package-lock.json`, `pyproject.toml`, `uv.lock`, `Cargo.toml`, `Cargo.lock`, or any `__init__.py` — never counts. A finding fails validation, naming the job, the output, and the test: add the test to `context`, or list it in `ignoreTests` with a reason in the job's `prompt`. The refusal JSON also carries `suggestedIgnoreTests: {"<jobId>": ["tests/...", ...]}`, listing exactly the uncovered tests per job so the coordinator can paste them in.

## Ship

`ship <run-id> --repo OWNER/NAME --pr payload.json` pushes an integrated run's branch, opens or updates its pull request, waits for CI, and merges once everything is green — refusing at any earlier step leaves nothing pushed or merged. It requires the run to already be integrated (`integrate <run-id>` must have run first) and reuses that run's saved manifest `checks`, re-running them against the committed tree before filling `<!-- swarm:checks -->` in the PR body.

```sh
node tools/swarm.mjs ship <run-id> --repo OWNER/NAME --pr payload.json [--require-section NAME]... [--no-merge] [--merge-method squash|merge|rebase] [--timeout SECONDS] [--poll SECONDS]
```

- `--repo OWNER/NAME`: required, the GitHub repository to push to and open the PR against.
- `--pr payload.json`: required, a JSON file `{title, head, base, body}` (`draft`/`maintainer_can_modify` optional), resolved against `--root`.
- `--require-section NAME`: repeatable; refuse to push unless the PR body has a non-blank `## NAME` section with the checks placeholder already filled in.
- `--no-merge`: stop at `ready` once CI is green instead of merging.
- `--merge-method squash|merge|rebase`: default `squash`.
- `--timeout SECONDS` / `--poll SECONDS`: how long to wait for CI and how often to poll; defaults are 45 minutes and 20 seconds respectively (the grace period before an empty rollup counts as `no-ci` is five minutes and is not configurable from the CLI).

`ship` prints one JSON line: `{status, repo, pr, url, sha, mergeSha, checks, ci, reason}`, where `status` is one of `merged | held | ready | refused | checks-failed | ci-failed | no-ci | timeout | merge-failed` and fields that do not apply are `null`. A PR body whose first non-blank line starts with `**needs ` is never merged (`held`); a person merges it. Exit code is `0` for `merged`, `held`, or `ready`, and `1` for every other status.

## Go

`go <manifest.json|run-id> [--commit-message MSG] [--repo OWNER/NAME --pr payload.json] [--require-section NAME]... [--mutants] [--merge-method M] [--timeout S]` is one command carrying a manifest (or an already-started run) as far toward a merged change as the given flags allow, stopping at the first stage that fails:

1. **run** — given a manifest path, validate it, run it to completion, and wait; given a run id instead, this stage is skipped entirely and that run id is used as-is.
2. **integrate** — `integrate <run-id>` with the manifest's `checks` (and mutation checks when `--mutants` is passed or the manifest declares `mutants`).
3. **commit** — only when `--commit-message` is given: stage exactly that run's integrated output files (`git add --` plus that exact file list, never `git add -A`) and commit them with the message verbatim.
4. **ship** — only when both `--repo` and `--pr` are given: the same `ship` described above, forwarding `--require-section`, `--merge-method`, and `--timeout`. It requires stage 3 to have run, or an already clean tree.

```sh
node tools/swarm.mjs go examples/smoke.json --commit-message "Add render review" --repo acme/widgets --pr payload.json
node tools/swarm.mjs go <run-id> --commit-message "Add render review"
```

`go` prints one JSON line: `{status, stage, runId, cost, warnings, integrate, ship, reason}`, where `stage` is the last stage reached (`run`, `integrate`, `commit`, or `ship`), `integrate`/`ship` hold that stage's own result object (or `null` if never reached), and `status` is one of `merged | held | ready | integrated | committed | failed`. Exit code is `0` for every status except `failed`.

## Advisory preflight

`node tools/swarm.mjs preflight <manifest>` validates without starting workers, then reports file byte breakdowns, repeated copied context, output/input snapshot hazards, task-size advisories, and each job's `agent`, `model`, `tier`, and `tierReason` (`null` when unset). It does not automatically split or dispatch tasks, and it does not choose or verify a tier; that stays the coordinator's judgment call against [the routing checklist](orchestration.md). See [active orchestration](orchestration.md) and [manager task contracts](managed-feature-plan.md).

`monitor` includes content-free CLI byte counts and output timestamps where observable. API requests without streaming report unavailable progress; neither output nor silence proves whether a worker is making useful progress.

Preflight exits **0 for a valid report even when `reviewRequired` is true**: advisories require coordinator judgment and an agreed contract can justify parallel snapshots. Invalid manifests/paths exit nonzero. CI that requires a reviewed plan must inspect `reviewRequired`, `advisories`, and `snapshotHazards`; a zero exit is validation, not approval to dispatch. Preflight reads and validates file contents (including API UTF-8 checks), so large repeated contexts also incur repeated local I/O.
