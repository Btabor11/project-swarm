# Setup and first run

Project Swarm runs fresh Claude Code processes or single-request API jobs for a coordinator. It does not attach to an existing terminal or run a background service. `install.mjs --user` does register the skill in your agent homes (`~/.claude`, `~/.codex`) so a supporting agent can discover it automatically, but it never updates itself and never touches credentials.

## Requirements

- Node.js 20.3 or newer.
- For Claude jobs only: Claude Code installed, authenticated, and available as `claude` on your PATH.
- For Claude jobs only: a Claude CLI version supporting the adapter's restricted mode, safe mode, explicit tool selection, noninteractive permissions, strict MCP configuration, and streaming JSON output.
- A project whose files you are authorized to send to the selected model provider.

The initial real-provider validation was on macOS. Linux is an intended platform; run the tests and a smoke exchange in your environment. Windows is not a supported platform claim for this release.

This package has no runtime npm dependencies. Claude Code is installed and authenticated separately. API adapters need no provider SDK: see [provider setup](providers.md) for environment authentication and local Ollama. This project does not provide model access or replace your provider's billing and account setup.

## Check the checkout

From your Project Swarm checkout:

```sh
node --version
claude --version
npm test
node tools/swarm.mjs doctor
```

`doctor` checks local prerequisites and CLI flag compatibility. A successful diagnostic does not establish that authentication, billing, a requested model, or network access will work. A real smoke job provides that evidence.

Read [the security boundaries](../SECURITY.md) before copying sensitive files into a worker context. Add `.swarm/` to your project's `.gitignore`; local run records can contain source code, prompts, and provider responses.

## One shared install per machine

Project Swarm uses a single shared install per machine instead of a copy inside every project. Clone (or update) it once at `~/.project-swarm` (override the location with the `PROJECT_SWARM_HOME` environment variable), then register the skill for every agent home on the machine:

```sh
node ~/.project-swarm/tools/install.mjs --user
```

This writes `skills/project-swarm/SKILL.md` and its `references/` guides into `~/.claude/skills/project-swarm/` and `~/.codex/skills/project-swarm/`, whichever of those agent homes already exist on this machine (it reports any it skipped), with the skill's runner placeholder resolved to this install's absolute `tools/swarm.mjs` path. It is idempotent and only ever writes files inside those `skills/project-swarm/` directories. It refuses to run from a checkout with uncommitted changes to `tools/` or `skills/` unless you pass `--dev`, so a development checkout can't silently masquerade as a release.

## Link a project

From the shared install, point one project at it:

```sh
node ~/.project-swarm/tools/install.mjs /path/to/your-project
```

This writes a small pointer file, `<project>/.project-swarm.json` (`{"install": "<absolute install root>", "version": "<installed version>"}`), and registers the project path in the install's own `.swarm-projects.json` so `swarm update --projects` can find it later. It creates `coordination/` example manifests only if the project doesn't already have any. It does not copy `tools/`, `tests/`, or `skills/` into the project, and does not change package scripts, global settings, credentials, or the target's Git remote.

Run commands against that project with `--root`:

```sh
node ~/.project-swarm/tools/swarm.mjs --root /path/to/your-project doctor
```

Without `--root`, the runner uses its own install directory as the project. With `--root`, manifests, copied inputs, outputs, and `.swarm/` records are all resolved in the selected project. An explicit root is not permission to use files from other projects as context. If the project's `.project-swarm.json` version differs from the running install's version, `run` and `validate` print one warning line to stderr and continue.

## Run the smallest useful exchange

From the shared install itself, use `examples/smoke.json`. From a linked project, use `coordination/swarm-smoke.json` and `--root` instead. The smoke assignment needs no project context. Before running a review example in another project, read it and adapt its explicit file paths to files that exist there. Context paths are relative to the selected project root, not relative to the manifest's directory.

```sh
node ~/.project-swarm/tools/swarm.mjs validate examples/smoke.json
node ~/.project-swarm/tools/swarm.mjs run examples/smoke.json
```

In a linked project, the equivalent commands are:

```sh
node ~/.project-swarm/tools/swarm.mjs --root /path/to/project validate coordination/swarm-smoke.json
node ~/.project-swarm/tools/swarm.mjs --root /path/to/project run coordination/swarm-smoke.json
```

The runner prints a run ID and remains attached while its workers execute. Substitute that ID below:

```sh
node ~/.project-swarm/tools/swarm.mjs status <run-id>
node ~/.project-swarm/tools/swarm.mjs inspect <run-id>
```

Review the worker's response and every proposed file in `.swarm/workspaces/<run-id>/<job-id>/`. Inspect also reports integration readiness; it does not approve the content for you.

Only after review:

```sh
node ~/.project-swarm/tools/swarm.mjs integrate <run-id>
```

Run the target project's relevant tests and inspect its actual behavior. A successful worker process or integration is not a substitute for application validation.

## Troubleshooting

- **Unsupported Claude flag:** inspect `claude --help` and the `doctor` report. Use a compatible CLI version. Do not remove restricted-mode or tool restrictions merely to make a job start.
- **Authentication or unavailable model:** inspect the job's `stderr.log` and `provider.jsonl` locally. Correct the provider setup outside the worker, then start a new run. Do not put credentials in a manifest.
- **Missing context:** supply an explicit existing file path relative to the selected project root. Directory names and glob patterns are not accepted.
- **Integration conflict:** preserve the newer project content. Start a fresh task from that content or manually review the proposed changes; the runner intentionally does not force an overwrite.
- **A worker says it ran tests:** none of the shipped adapters grant shell tools. The coordinator must run the actual tests.
- **Stale `running` status after a machine or runner crash:** inspect the records and processes you own. Status files are historical evidence, not proof that a process is alive. Never kill an unrelated terminal based on a stale PID.
- **Stale integration lock:** confirm no integration is active before manually removing `.swarm/integration.lock`. Locks are not silently discarded after crashes.
- **A project still has its own `tools/swarm.mjs` and `skills/`:** that is an old per-project copy from before the shared-install model. Run `node ~/.project-swarm/tools/swarm.mjs update --projects` to see it reported, then again with `--yes` to replace it with a pointer; the old files are moved into a timestamped `.swarm-old-copy-*/` folder in that project, never deleted.

For upgrades, run `node ~/.project-swarm/tools/swarm.mjs update` in the shared install. It refuses if `tools/` or `skills/` have uncommitted changes, fetches tags, checks out the newest `v*` tag, reinstalls the skill, and reports the changelog sections between your previous and new version. It is a no-op if you are already on the newest tag. Nothing updates itself: run this only when you decide to.

## Public download

Anyone can clone the toolkit without a GitHub account or invitation:

```sh
git clone https://github.com/Btabor11/project-swarm.git
```

The owner name in the URL is the source repository location. You do not sign into that account. You can also download the source archive from the release page. Model execution still uses your own provider setup.

`doctor all` lists all seven adapters without making network requests. `configured` means a required environment key is present, or a local Ollama endpoint is selected; it does not prove service health or model access. Each run checks only its selected providers. Default concurrency is 2; set `concurrency` to an integer from 1 to 32 when you deliberately want more simultaneous workers.

## Preflight before larger assignments

Run `node ~/.project-swarm/tools/swarm.mjs --root /path/to/project preflight coordination/my-tasks.json` before dispatch. Resolve invalid paths, inspect large context/output warnings, and split independent concerns into bounded deliverables. Output-to-context dependencies use the starting snapshot, even with concurrency one: integrate the producer before starting a dependent batch, or supply an explicit stable interface contract. See [orchestration](orchestration.md) for the checklist and sizing guidance.

`monitor` now reports CLI stdout/stderr byte counts and last-output times without including worker prose in progress metadata. API workers without streaming remain explicitly unobservable. An output timestamp is an activity signal, not evidence of task correctness.

For features with a queue and background worker, reserve a dependent integration
check after the producer and consumer interfaces settle. Exercise the real
handoff with a controlled external provider; test results from the two workers
separately do not establish that queued work starts. See the
[automation integration study](automation-integration-study.md).

For automatic agent features, include the installed manager and eligible worker
in readiness checks. Use the bundled prompts and effective permission limits
in acceptance fixtures. A provider key or model name being present is not a
successful tool round trip; verify the selected route with synthetic data when
activation depends on tool use. Keep prepared, activated, and observed outcome
claims distinct. The [mission readiness follow-up](automation-integration-study.md)
records the setup and verification gaps found in a real CRM implementation.
