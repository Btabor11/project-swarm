# Providers and setup

Project Swarm 1.2 supports seven adapters. Configure only the providers your manifest uses. No SDK dependencies are required. The toolkit does not install provider accounts, purchase credits, pull model weights, or modify your global configuration.

## Choose the execution style

- **Hermes (`hermes`)** is the Nous Research Hermes Agent CLI. It receives copied text through stdin under safe mode, ignored user configuration/rules, an explicit `none` toolset, and one turn.
- **Qwen (`qwen`)** is Qwen Code (the best match for the requested “Quin”). It receives copied text through stdin under safe mode, default approval, a zero tool-call budget, and one turn. It never uses the synthetic JSON-schema tool exemption.


- **Claude (`claude`)** starts a fresh restricted CLI process with copied files and scoped file tools. Authentication belongs to the installed Claude Code CLI. The repository's website case study records real Claude exchanges.
- **OpenAI (`openai`)** makes one Responses API request with strict structured output and no tools. It reads `OPENAI_API_KEY` from the coordinator environment; a ChatGPT or Codex login is not automatically an API credential.
- **Gemini (`gemini`)** makes one `generateContent` request with JSON schema output and no tools. It reads `GEMINI_API_KEY`, falling back to `GOOGLE_API_KEY` when the first is absent.
- **Ollama (`ollama`)** makes one chat request to a server you already operate, using JSON schema output. Its default is `http://127.0.0.1:11434`. Select a model already available on that server. No Claude or cloud account is needed for an unauthenticated local server.
- **Lambda (`lambda`)** makes one OpenAI-compatible chat-completions request with a strict JSON schema and no tools. Its default is hosted Lambda Inference at `https://api.lambda.ai`, reading `LAMBDA_API_KEY`. Set `SWARM_LAMBDA_URL` to an origin you operate to use your own GPU host instead; the key is optional there. Each request carries a unique `X-Helm-Session` header (`${SWARM_LAMBDA_SESSION or "swarm"}-<request-nonce>-<job>`), including repeated runs with the same job ID in one process. The nonce uses cryptographic randomness and stays alphanumeric, preserving the header's separator format. A session-aware operator router can use it for replica selection and rate-limit buckets; actual distribution and hosted endpoint handling depend on the server and are not verified by local adapter tests. Set `SWARM_LAMBDA_SESSION` to a stable per-user value if your origin buckets fair-share by caller.

Lambda's [official inference page](https://lambda.ai/inference) says its hosted Inference API is winding down. For new setups, plan around an operator-owned endpoint with schema-constrained output. Hosted access remains unverified; the wind-down notice does not establish a shutdown date. The contributor reports a separate self-hosted vLLM exercise, which does not verify another account, host, or model.

API jobs receive only selected UTF-8 text files, including existing output files. They cannot browse your repository, execute tests, use MCP, view images, or call tools. They return a summary and complete file contents, which the runner validates before writing into the copied workspace. The coordinator still reviews and integrates them. UI review recipes evaluate supplied source or written flows, not rendered screenshots.

## Check setup without sending context

```sh
node tools/swarm.mjs doctor all
node tools/swarm.mjs doctor openai
node tools/swarm.mjs doctor gemini
node tools/swarm.mjs doctor ollama
node tools/swarm.mjs doctor lambda
```

`doctor` without an argument checks Claude for backward compatibility. `doctor all` reports each provider independently. API `configured` means an environment credential is present, or an Ollama or Lambda origin you operate has been selected. `liveVerified: false` is deliberate: diagnostics do not contact endpoints or prove authentication, model access, server health, quota, or output-schema support. `run` checks only the providers its jobs actually select.

Claude `--version` and `--help` write to private temporary files rather than pipes: a CLI that exits before flushing its pipe can otherwise appear to lack supported safety flags. Each diagnostic has a ten-second timeout. The subprocess uses an OS file-size limit of at most 1 MiB per file, and capture at or above 512 KiB is rejected conservatively to detect truncation across supported shell block sizes. Files are removed on success and failure; missing required flags still fail compatibility. This diagnostic capture does not apply to worker transcripts or prove provider authentication.

Configure credentials using your normal secure environment/secret manager, outside the worker. Never put real keys in a manifest, command example committed to Git, prompt, or copied context. The runner does not read `.env` automatically. If you choose Node's environment-file feature, keep that file outside version control and never include it as context. API account access and billing are separate from cloning this public repository.

For Claude installation, follow [Anthropic's setup guide](https://code.claude.com/docs/en/setup), authenticate through the CLI, and run the compatibility check. Required restrictions are never silently removed to support an older CLI.

## A bounded first exchange

Read and adapt one example before executing it. The example model names are starting points, not a claim of availability on your account. Use a model supported by your provider with structured JSON output; for Ollama, select an installed model capable of following the schema.

```sh
node tools/swarm.mjs validate examples/openai-smoke.json
node tools/swarm.mjs run examples/openai-smoke.json
# Alternatives: examples/gemini-smoke.json, examples/ollama-smoke.json, or examples/lambda-smoke.json
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
```

Each API smoke has empty context, one declared Markdown output, and a two-minute timeout. The output limit is 1,024 tokens except for Lambda's 2,048-token example. Increase it if your model needs additional reasoning allowance. Review the proposed file and summary, then integrate. For a read-only smoke, change `outputs` to `[]` and ask for an acknowledgment in the summary. Installed copies use `coordination/swarm-openai-smoke.json` (or the corresponding provider name).

The four API adapters have deterministic mocked-transport tests covering their contracts and failure handling. They have **not been verified against live cloud credentials, a live Ollama model, or a live Lambda endpoint as part of this release**. A passing test or doctor result is not such verification. Record your own observed resolved model and successful read-only/writing exchanges before assigning substantial work. Missing model metadata stays null rather than being inferred.

## Limits, cancellation, and errors

All API jobs must name `model`. `maxOutputTokens` defaults to 8,192 and accepts 256–32,768; choose a smaller value for simple tasks. Provider reasoning may consume output allowance. This is not a small effect on a reasoning model: an observed vLLM deployment with a reasoning parser returned `finish_reason: "length"` and null content on a trivial task at 512 tokens, intermittently, because the whole budget went to reasoning the model never emitted as content. The job fails closed rather than writing a partial file, but the cause looks like a schema or load fault and is neither. Budget for reasoning plus the envelope, and prefer a generous cap: an unused allowance costs nothing. Incomplete, refused, malformed, oversized, or wrongly scoped output fails the job; partial files are not accepted. There are no automatic retries.

Concurrency defaults to 2 and can be explicitly set from 1 to 32 across providers. More concurrent jobs can increase resource load and simultaneous charges. Tokens and timeouts are not dollar budgets. Cancellation aborts the local HTTP request and response reading, but remote work or charges may already have occurred. API cost is recorded as unavailable, not calculated from assumed prices.

HTTP failures record a status and omit the response body. Transport and response-stream exceptions are sanitized; request headers and raw API responses are not logged. Read-only summaries and generated files can still contain supplied source. Keep `.swarm/` private. For authentication errors, check the selected provider's account/environment setup outside the runner; for schema errors, verify the chosen model's structured-output capability. Do not weaken file validation as a workaround.

## Endpoints and local models

OpenAI and Gemini use fixed HTTPS endpoints. Arbitrary base-URL environment variables are intentionally ignored, and manifests cannot specify endpoints. Redirects are refused, including same-origin redirects, to avoid forwarding credentials to another destination.

Ollama accepts an optional **operator-controlled** `SWARM_OLLAMA_URL` containing only an origin, for example `http://127.0.0.1:11434` or an explicitly trusted `https://models.example.com`. HTTP is allowed only for the exact loopback hosts `127.0.0.1`, `[::1]`, and `localhost`; remote hosts require HTTPS. Credentials in URLs, query strings, paths, and fragments are rejected. `OLLAMA_API_KEY`, if present, is sent only to the selected Ollama origin. Setting a remote origin explicitly trusts it with your copied files and that key. DNS, machine policy, and remote service ownership are not authenticated by this toolkit.

Lambda applies the same origin rule to `SWARM_LAMBDA_URL`, defaulting to `https://api.lambda.ai` when unset. `LAMBDA_API_BASE` and other base-URL variables are intentionally ignored. A loopback origin such as `http://127.0.0.1:8000` is accepted so an SSH tunnel to a rented GPU host needs no certificate; any other host must be HTTPS. The adapter sends `response_format` with a strict JSON schema, so the selected model must support schema-constrained decoding. If it does not, choose a model that does or serve one that supports guided decoding; do not weaken envelope validation to compensate.

This is an Ollama chat/schema adapter, not a universal OpenAI-compatible proxy adapter. It does not assume every local model supports JSON schema reliably. If local inference is slow, first reduce input/output scope and concurrency rather than disabling validation.

## Official protocol references

Implementation references, reviewed for this release:

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format` with a JSON schema; the adapter sets `store: false` and provides no tools.
- [Gemini generateContent reference](https://ai.google.dev/api/generate-content): model-scoped requests, `generationConfig.responseMimeType`, `responseJsonSchema`, candidate finish reason, and usage metadata.
- [Ollama chat API](https://docs.ollama.com/api/chat): `stream: false`, schema-valued `format`, message content, completion state, and token counts.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference): fixed restricted CLI flags and structured result events.

Provider behavior, models, and account access can change. Keep compatibility checks and real smoke verification separate from mock unit tests.

## Hermes and Qwen Code installation and compatibility

Use the upstream installation steps for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation/) or [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/). Qwen's official npm package is `@qwen-code/qwen-code`; install it with your preferred project-local package setup and expose its `qwen` binary on PATH for the coordinator. Hermes requires its own upstream Python environment and `hermes` entrypoint. This toolkit does not modify global shell profiles, install gateways, or authenticate accounts automatically.

```sh
node tools/swarm.mjs doctor hermes
node tools/swarm.mjs doctor qwen
node tools/swarm.mjs validate examples/hermes-smoke.json
node tools/swarm.mjs run examples/hermes-smoke.json
# Qwen equivalent: examples/qwen-smoke.json
```

The doctor checks executable version/help and all required flags, failing closed when restrictions are missing. It does not prove authentication or execute a model. Authenticate separately through each CLI's normal setup. New CLI adapters have deterministic subprocess contract tests; neither authenticated Hermes nor Qwen inference is claimed as live-verified in this release.

Hermes uses `chat --safe-mode --ignore-user-config --ignore-rules --toolsets none --query-file - --oneshot --format stream-json --max-turns 1`. The explicit `none` selection relies on the upstream resolver's empty result for an unrecognized named toolset; **an empty string is not equivalent**, because it enables default toolsets. Safe mode disables plugins/hooks/MCP and rule injection. The runner strips inherited dispatcher/task variables that could re-enable another task's lifecycle tools. This behavior is source-reviewed, not an OS sandbox guarantee; incompatible upstream changes require updating the adapter.

Qwen uses safe mode, default approval, `--max-tool-calls 0`, and one session turn. The upstream setting defines zero as aborting before the first tool call. No `--json-schema` is passed, because its synthetic completion tool is exempt from the tool-call budget. Safe mode ignores `--core-tools`, so this adapter never mistakes an empty core-tools value for a deny-all policy. Task data is serialized on stdin and the fixed prompt is not a slash command. Both adapters require exactly one successful terminal JSONL record, reject tool events, validate every output path/content, and let only the coordinator import files.

These CLIs may read their authentication stores. Hermes may retain its own host session logs; Qwen is launched with chat recording, telemetry, and OpenAI debug logging disabled although each invocation is fresh and never resumed. Review upstream retention settings; `.swarm/` is not necessarily the only copy of CLI transcript data. Their host process environment is not an OS isolation boundary.

Primary restriction references: [Hermes CLI flags and result events](https://hermes-agent.nousresearch.com/docs/reference/cli-commands), [Hermes tool selection source](https://github.com/NousResearch/hermes-agent/blob/main/model_tools.py), [Qwen headless mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/), and [Qwen tool-budget schema](https://github.com/QwenLM/qwen-code/blob/main/packages/vscode-ide-companion/schemas/settings.schema.json).

Local compatibility evidence: official npm Qwen Code 0.24.0 was installed into an ignored verification directory and its real version/help output confirmed the required flags, including the explicit zero-tool-call semantics. This did not authenticate or send an inference request. Hermes was not installed in the verification environment; its adapter remains source-reviewed and mock-process tested until an operator passes doctor and a bounded live exchange.
