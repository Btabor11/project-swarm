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
- `jobs`: required array of 1–50 jobs.
- `concurrency`: optional integer from 1 to 3; default is 2. The effective parallelism is never greater than the number of jobs.

Unknown top-level fields are rejected.

## Job fields

- `id`: required unique string, 1–80 characters. The first character is an ASCII letter or digit; remaining characters may also include `_` and `-`.
- `agent`: required, exactly `"claude"`. No other provider adapter is shipped.
- `model`: optional model identifier or alias passed to Claude Code. The first character is an ASCII letter or digit; remaining characters may also include `.`, `_`, `:`, `/`, and `-`. Maximum length is 120 characters. Syntax validation does not prove provider availability.
- `prompt`: required nonblank string of at most 100,000 characters. Include the task, expected output, and relevant acceptance criteria.
- `context`: required array of explicit existing relative file paths, at most 100 entries. These files are copied for the worker to read.
- `outputs`: required array of explicit relative file paths, at most 100 entries. Existing files are copied automatically; new files may be created. An empty array creates a read-only job.
- `timeoutMs`: optional integer from 50 to 3,600,000 milliseconds. Default is 300,000 milliseconds, or five minutes.

Unknown job fields are rejected. Manifests cannot specify executable paths, arbitrary provider commands, environment variables, shell scripts, MCP servers, or additional tools.

## File rules

Paths are relative to the selected project root. Use forward slashes. Do not use absolute paths, empty segments, `.` or `..` segments, backslashes, directories, or glob patterns. Symlinks are refused along the checked path.

`.git`, `.swarm`, `.env`, and names beginning `.env.` are reserved path segments. These checks do not recognize every possible secret filename: explicitly audit the contents you choose to copy.

Files must be regular files no larger than 16 MiB. Each job's combined copied files are limited to 32 MiB. A context file must already exist. An output may be new, including a new nested path. Duplicate entries within either array are rejected; a path may appear in both `context` and `outputs` when a worker needs to edit a file it reads.

Each output has exactly one writer per manifest. Output collisions and overlapping file/directory output paths are rejected. There is no automatic handoff of one worker's new output to another worker in the same run.

Read-only jobs receive `Read`, `Glob`, and `Grep`. Writing jobs additionally receive `Write` and `Edit`. Workers do not receive shell, network, delegation, or MCP tools. The model provider still requires network access through Claude Code.

## Commands

```sh
node tools/swarm.mjs doctor
node tools/swarm.mjs validate examples/smoke.json
node tools/swarm.mjs run examples/smoke.json
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
node tools/swarm.mjs integrate <run-id>
node tools/swarm.mjs cancel <run-id>
```

Use `--root /path/to/project` to select a project explicitly. Otherwise the runner uses its own installed project root. Manifests are loaded from the selected root.

`validate` checks the assignment, paths, and copied-file size limits without creating a run or invoking a model. `doctor` diagnoses local prerequisites without running a model task. `status` reports saved run state. `inspect` reports proposed-output sizes, statuses, and current conflicts without editing files. Neither inspection nor validation approves content or runs application tests.

After installing into a project, use `coordination/swarm-smoke.json` and `coordination/swarm-parallel-review.json` in place of the standalone checkout's `examples/` paths. `--root` may appear before or after the command.

## Saved records

Each run uses these project-local locations:

```text
.swarm/
  runs/<run-id>/
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

The exact prompt, model response, and provider events are local evidence, not material to publish automatically. Provider metadata may contain usage and actual model identifiers when the CLI emits them. Missing metadata must be reported as unavailable, not inferred from a requested alias.

An overall successful run has `status: "complete"`; individual jobs may instead fail, time out, or be cancelled. A zero subprocess exit code alone is insufficient: the runner requires a successful provider result event and rejects malformed output, missing results, and reported permission denials.

## Integration contract

Integration requires a complete run from the same project, a matching saved manifest and worker record, and all declared output files. It validates every candidate and original target hash before writing any project output. If any target changed after the snapshot, integration stops with a conflict. It does not merge textual conflicts, propagate deletions, or import undeclared files.

An integration lock serializes integrations through this runner. Individual file replacements are atomic, with best-effort rollback on a caught write failure. This is not a transactional filesystem or protection against an unrelated process editing files concurrently. Keep a single coordinator for project writes and use normal version control.
