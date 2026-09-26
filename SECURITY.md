# Security and scope

Project Swarm is a coordinator for fresh Claude CLI and tool-free API jobs, copied file context, and reviewed integration. It is not an operating-system security sandbox and is not intended to run adversarial code or isolate an untrusted model from all host data.

## What the runner restricts

- Manifests name explicit project-relative input and output files.
- Path traversal, reserved paths, checked symlinks, duplicate writers, and invalid manifest fields are refused.
- Each job runs in a separate copied workspace inside the selected project.
- Claude receives file-reading tools and, for writing jobs, file-editing tools. Shell, delegation, and MCP tools are not enabled.
- The runner starts fresh processes with session persistence disabled; it does not discover or attach to existing terminals.
- Output and elapsed runtime are bounded; cancellation targets the active runner's own worker groups.
- Integration accepts declared outputs only after a complete run, checks original target hashes, and refuses missing outputs and conflicts.

These are application-level safeguards. They reduce accidental scope expansion and unsafe integration but do not replace host access controls.

## What is outside that boundary

Claude Code still uses its normal host authentication, configuration, environment, and provider connection. File-tool restrictions are not proven to block every possible absolute-path read. The worker prompt forbids out-of-scope reads, but prompts are not a filesystem permission boundary.

The Claude child process inherits the coordinator process environment. Avoid launching it from an environment containing unrelated secrets. Do not copy credentials, private customer data, proprietary files you cannot share, or secrets embedded under ordinary filenames into context. `.env` path checks are not a secret scanner.

Worker responses and source files may contain malicious instructions. Treat them as untrusted data. Never execute a command just because a report requests it, and never bypass local approval or sandbox controls to satisfy a worker.

Integration does not semantically review code, run tests, resolve conflicts, or make an entire multi-file change crash-atomic. An unrelated process can still edit the project concurrently. Keep a single coordinator for writes, preserve version-control history, and inspect changes before deployment.

If stronger containment is required, use an approved container or OS sandbox with a deliberately designed filesystem, credential, and network policy. This package does not configure that layer.

## Local records and publication

`.swarm/runs/` may contain exact prompts, provider transcripts, source excerpts, model metadata, and errors. `.swarm/workspaces/` contains copied project files and generated outputs. Keep `.swarm/` out of version control and review any excerpt before sharing it.

The runner does not upload logs to a separate project service. Claude Code and the API adapters communicate with their selected model provider to perform the assignment; provider account terms and data handling still apply.

Timeouts and cancellation are not spending caps or guarantees of provider-side cancellation. A worker can incur provider usage before failing or being stopped.

## Reporting a vulnerability

Do not post sensitive reproduction material in a public issue. Use the repository's private vulnerability-reporting feature if enabled, or contact the repository owner through an existing private channel. For a private fork, follow your organization's security-reporting process.

Provide the affected version or commit, operating system and Node version, a minimal synthetic reproduction, expected versus observed behavior, and impact. Do not include authentication material or real customer files. Coordinate disclosure and a fix with the maintainer before sharing details publicly.

## HTTP adapter boundary

OpenAI and Gemini use fixed HTTPS API endpoints. They ignore arbitrary base-URL variables and refuse redirects. Ollama defaults to `http://127.0.0.1:11434`; only an explicit operator `SWARM_OLLAMA_URL` can change it. HTTP is allowed only for exact loopback hostnames, while remote origins require HTTPS. URLs cannot include user information, paths, query strings, or fragments. Setting a remote origin explicitly trusts that service with copied context and any optional `OLLAMA_API_KEY`; the runner does not discover endpoints or verify their operator. DNS and host network policy remain outside this boundary.

Lambda follows the same origin rule through `SWARM_LAMBDA_URL`, defaulting to `https://api.lambda.ai` and ignoring other base-URL variables. Loopback HTTP is permitted so a tunnelled host needs no certificate; every other origin must be HTTPS, and `LAMBDA_API_KEY` is sent only to the selected origin. Because that origin may be a host you operate rather than a vendor endpoint, the operator owns its authentication, network exposure, and model choice; selecting it trusts that host with copied context and the key. A self-hosted origin without a key is accepted as configured, so an endpoint reachable by others is usable by others.

API workers have no tools or host filesystem access through this runner. They receive selected UTF-8 text, including existing outputs, and return a single JSON envelope. Only exact declared paths with string contents are accepted; duplicate, missing, additional, refused, or incomplete outputs fail the job. API request headers, raw response bodies, and transport error details are not saved. Numeric usage and validated model identity are recorded separately. Output strings are checked against the known nonempty provider keys after JSON decoding, so a JSON-escaped key in a summary or generated file is also discarded before saving. Retained model and usage metadata are checked as well. This is not a general secret scanner: do not include sensitive text in prompts or context.

HTTP cancellation aborts the local request, including response-body reading. It does not guarantee cancellation of remote inference or charges. There are no automatic retries, preventing an error from silently multiplying requests. Raising concurrency from the default 2 up to 32 can increase concurrent API usage and local load.

## Additional CLI adapters

Hermes and Qwen run fresh processes in copied workspaces, receiving serialized UTF-8 context and returning a strictly validated file envelope. Qwen uses safe mode plus a zero tool-call budget and disables chat recording/telemetry/debug logging. Hermes uses safe mode, ignored rules/configuration, and an explicit none toolset. See [provider restrictions](docs/providers.md) for source-reviewed behavior, compatibility checks, inherited-task cleanup, and host log limitations. Neither mode is an OS sandbox, and neither new CLI has authenticated live inference verification in this release. The runner rejects tool events and unsuccessful terminal records; it never integrates raw CLI filesystem side effects.

CLI lifecycle cleanup targets only the process group created for that fresh worker, on normal completion, worker error, timeout, and cancellation. It sends SIGTERM, escalates remaining group members to SIGKILL after a grace period, and surfaces non-ESRCH signal failures as `cleanupError` with a failed job. An original timeout/cancellation reason is retained separately as `terminationReason`; a cleanup failure never permits integration. A successful signal is not a host-wide process audit. Descendants that deliberately daemonize, create a new session/process group, or otherwise escape the owned group are outside this cleanup boundary; the runner does not search for or kill other groups. Use an OS/container supervisor when containment of adversarial descendants is required.

## Box checks

When a Claude job includes `boxChecks`, the runner provides one MCP tool, `run_check`, that invokes the job's manifest-declared checks inside a dedicated OpenShell sandbox with no network egress. The tool enforces that only the registered check's argv is executed (no shell interpretation), the sandbox directory is replaced on each sync, and check outputs stay in the sandbox (stdout/stderr tails are returned, but no artifacts are pulled back). This is not an operating-system security boundary and cannot isolate an untrusted model from all host data; it is a controlled execution environment for checking code in a copied workspace. The sandbox image is rebuilt when dependencies change, shares no budget with live units, and is separate from host shells and the Hermes unit sandbox.
