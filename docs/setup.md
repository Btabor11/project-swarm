# Setup and first run

Project Swarm runs fresh Claude Code processes or single-request API jobs for a coordinator. It does not attach to an existing terminal, run a background service, or install a global agent skill.

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

## Install into a project

Run the installer from the Project Swarm checkout:

```sh
node tools/install.mjs /path/to/your-project
```

The installer copies the runner, tests, skill, examples, supporting documentation, and license material into the target project. It prevalidates the destinations and refuses to overwrite a file with different contents. Identical existing files are accepted, so repeating an unchanged installation is safe. Inspect the reported file list and commit the installed files with your project's normal review process.

The installed entry points are:

- `tools/swarm.mjs`, `tools/api-adapters.mjs`, and the runner/adapter tests.
- `skills/project-swarm/SKILL.md`, with supporting guides in its `references/` directory.
- `coordination/swarm-smoke.json`, `coordination/swarm-parallel-review.json`, and all API/workflow example manifests.
- License material in `licenses/project-swarm/`.

Installation does not configure an editor or globally register the skill. Ask your coding agent to read `skills/project-swarm/SKILL.md` explicitly, or register that file through the skill-discovery mechanism your agent supports. Do not assume all editors discover the same skill locations.

You can also keep the runner in its own checkout and select a target explicitly:

```sh
node tools/swarm.mjs --root /path/to/your-project doctor
```

Without `--root`, the runner uses its own installed project root. With `--root`, manifests, copied inputs, outputs, and `.swarm/` records are all resolved in the selected project. An explicit root is not permission to use files from other projects as context.

## Run the smallest useful exchange

From the standalone checkout, use `examples/smoke.json`. From a project where you ran the installer, use `coordination/swarm-smoke.json` instead. The smoke assignment needs no project context. Before running a review example in another project, read it and adapt its explicit file paths to files that exist there. Context paths are relative to the selected project root, not relative to the manifest's directory.

```sh
node tools/swarm.mjs validate examples/smoke.json
node tools/swarm.mjs run examples/smoke.json
```

In an installed project, the equivalent commands are:

```sh
node tools/swarm.mjs validate coordination/swarm-smoke.json
node tools/swarm.mjs run coordination/swarm-smoke.json
```

The runner prints a run ID and remains attached while its workers execute. Substitute that ID below:

```sh
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
```

Review the worker's response and every proposed file in `.swarm/workspaces/<run-id>/<job-id>/`. Inspect also reports integration readiness; it does not approve the content for you.

Only after review:

```sh
node tools/swarm.mjs integrate <run-id>
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

For upgrades, review the new release and compare its installed files with your local copies. The installer is intentionally not a force-update mechanism: an upgrade that changes an existing file requires a separately reviewed replacement.

## Public download

Anyone can clone the toolkit without a GitHub account or invitation:

```sh
git clone https://github.com/Btabor11/project-swarm.git
```

The owner name in the URL is the source repository location. You do not sign into that account. You can also download the source archive from the release page. Model execution still uses your own provider setup.

`doctor all` lists all seven adapters without making network requests. `configured` means a required environment key is present, or a local Ollama endpoint is selected; it does not prove service health or model access. Each run checks only its selected providers. Default concurrency is 2; set `concurrency` to an integer from 1 to 32 when you deliberately want more simultaneous workers.

## Preflight before larger assignments

Run `node tools/swarm.mjs preflight coordination/my-tasks.json` before dispatch. Resolve invalid paths, inspect large context/output warnings, and split independent concerns into bounded deliverables. Output-to-context dependencies use the starting snapshot, even with concurrency one: integrate the producer before starting a dependent batch, or supply an explicit stable interface contract. See [orchestration](orchestration.md) for the checklist and sizing guidance.

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
