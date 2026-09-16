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

API workers have no tools or host filesystem access through this runner. They receive selected UTF-8 text, including existing outputs, and return a single JSON envelope. Only exact declared paths with string contents are accepted; duplicate, missing, additional, refused, or incomplete outputs fail the job. API request headers, raw response bodies, and transport error details are not saved. Numeric usage and validated model identity are recorded separately. A returned credential matching the known provider keys is discarded. This is not a general secret scanner: do not include sensitive text in prompts or context.

HTTP cancellation aborts the local request, including response-body reading. It does not guarantee cancellation of remote inference or charges. There are no automatic retries, preventing an error from silently multiplying requests. Raising concurrency from the default 2 up to 16 can increase concurrent API usage and local load.
