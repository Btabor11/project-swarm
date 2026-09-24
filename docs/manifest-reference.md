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

**Precedence:** an explicit per-job `model` always wins. `tier` is descriptive, coordinator-facing routing guidance for choosing which provider/model to put in `model` (or which worker pool to dispatch to); the runner itself does not map `tier` to a model. A job may set both: `model` decides what actually runs, `tier`/`tierReason` document why that choice was made. A manifest with no `tier` field behaves exactly as before.

Unknown job fields are rejected. Manifests cannot specify executable paths, arbitrary provider commands, environment variables, shell scripts, MCP servers, or additional tools.

## File rules

Paths are relative to the selected project root. Use forward slashes. Do not use absolute paths, empty segments, `.` or `..` segments, backslashes, directories, or glob patterns. Symlinks are refused along the checked path.

`.git`, `.swarm`, `.env`, and names beginning `.env.` are reserved path segments. These checks do not recognize every possible secret filename: explicitly audit the contents you choose to copy.

Files must be regular files no larger than 16 MiB. Each job's combined copied files are limited to 32 MiB. A context file must already exist. An output may be new, including a new nested path. Duplicate entries within either array are rejected; a path may appear in both `context` and `outputs` when a worker needs to edit a file it reads.

Each output has exactly one writer per manifest. Output collisions and overlapping file/directory output paths are rejected. There is no automatic handoff of one worker's new output to another worker in the same run.

Claude read-only jobs receive `Read`, `Glob`, and `Grep`. Writing jobs additionally receive `Write` and `Edit`. These restricted adapters do not receive shell, network, delegation, or MCP tools. Codex uses a separate macOS OS sandbox and a full detached HEAD worktree, with shell access for tests; see [Codex setup and file grants](providers.md). API jobs have no tools; the runner sends only copied UTF-8 text without NUL bytes in one request and validates an exact output-file envelope before writing the copy. Cloud providers require network access; Ollama defaults to localhost.

## Commands

```sh
node tools/swarm.mjs doctor all
node tools/swarm.mjs doctor openai
node tools/swarm.mjs validate examples/smoke.json
node tools/swarm.mjs run examples/smoke.json
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs monitor <run-id>
node tools/swarm.mjs monitor <run-id> --view
node tools/swarm.mjs monitor <run-id> --view --watch 5
node tools/swarm.mjs wait <run-id>
node tools/swarm.mjs wait <run-id> --timeout 300
node tools/swarm.mjs inspect <run-id>
node tools/swarm.mjs integrate <run-id>
node tools/swarm.mjs integrate <run-id> --no-checks
node tools/swarm.mjs integrate <run-id> --require-checks
node tools/swarm.mjs integrate <run-id> --mutants
node tools/swarm.mjs cancel <run-id>
```

Use `--root /path/to/project` to select a project explicitly. Otherwise the runner uses its own installed project root. Manifests are loaded from the selected root.

`validate` checks the assignment, paths, and file size limits without creating a run or invoking a model. For Codex, both validate and preflight warn about uncommitted changes to declared context/output files because only HEAD is checked out; a declared `context` file that git does not track at all (untracked or ignored, not merely edited) is instead refused outright — `Job <id>: codex context file <path> is not tracked by git (codex sees HEAD only)` — since Codex would silently see nothing there. `run` performs the same validation before dispatching any worker. `doctor` diagnoses local prerequisites without running a model task. `status` reports saved run state. `inspect` reports each job's `agent`, `model`, `tier`, and `tierReason`, plus proposed-output sizes, owning `jobStatus`, and current conflicts without editing files. Its file `status` is `blocked` whenever the owning job is not complete, even if the worker left a partial file. Neither inspection nor validation approves content or runs application tests.

`inspect` additionally reports, per job, `result` — the worker's own final JSON-object line from its saved response (whatever keys it wrote, or `null` if no line parses as a JSON object) — and `costUsd` (a number when the provider reported one, else `null`). A `result.notes` array, if present, is capped at 20 entries of at most 500 characters each in the printed report; this is display data from the worker, never executed or trusted.

`wait <run-id> [--timeout SECONDS]` blocks, polling saved run status at most once a second, until the run reaches a terminal status (`complete`, `failed`, or `cancelled`); with no `--timeout` it waits indefinitely. It prints one compact JSON line, `{runId, status, durationMs, costUsd, jobs: [{id, status, costUsd, notes}]}`, where `costUsd` is the sum of the jobs' recorded provider costs when any are available, else `null`, and each job's `notes` come from the same final-JSON-line parsing as `inspect` (capped the same way). Exit code is `0` for `complete`, `1` for `failed`/`cancelled` (or an unknown run id), and `2` if `--timeout` expires first — in that case `status` in the printed line is still `running`.

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

Up to 10 checks per manifest. Inside `argv`, a whole item of exactly `{integrated}` expands to the run's integrated file paths (relative to the project root) as separate argv items; `{integrated:.py}` (or any other extension) expands to only the integrated files with that extension. If a placeholder expands to zero files, that check is skipped (`status: "skipped"`) rather than run with nothing to act on.

Checks run with `cwd` at the project root, the coordinator's inherited environment, and each check's own timeout; a later check still runs even if an earlier one fails, so a formatter can run before the tests that depend on its output. **Formatters may rewrite the files integration just wrote, and a failing check never rolls back the integration** — checks are reported, not a transactional gate. `integrate`'s own process exit code stays 0 when files integrate successfully regardless of check outcome; pass `--require-checks` to exit 1 when any check fails, times out, or errors. Pass `--no-checks` to skip them entirely (the result shows `checks: []` and `checksSkipped: true`).

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

## Advisory preflight

`node tools/swarm.mjs preflight <manifest>` validates without starting workers, then reports file byte breakdowns, repeated copied context, output/input snapshot hazards, task-size advisories, and each job's `agent`, `model`, `tier`, and `tierReason` (`null` when unset). It does not automatically split or dispatch tasks, and it does not choose or verify a tier; that stays the coordinator's judgment call against [the routing checklist](orchestration.md). See [active orchestration](orchestration.md) and [manager task contracts](managed-feature-plan.md).

`monitor` includes content-free CLI byte counts and output timestamps where observable. API requests without streaming report unavailable progress; neither output nor silence proves whether a worker is making useful progress.

Preflight exits **0 for a valid report even when `reviewRequired` is true**: advisories require coordinator judgment and an agreed contract can justify parallel snapshots. Invalid manifests/paths exit nonzero. CI that requires a reviewed plan must inspect `reviewRequired`, `advisories`, and `snapshotHazards`; a zero exit is validation, not approval to dispatch. Preflight reads and validates file contents (including API UTF-8 checks), so large repeated contexts also incur repeated local I/O.
