# Providers and setup

Project Swarm 1.1 supports four adapters. Configure only the providers your manifest uses. No SDK dependencies are required. The toolkit does not install provider accounts, purchase credits, pull model weights, or modify your global configuration.

## Choose the execution style

- **Claude (`claude`)** starts a fresh restricted CLI process with copied files and scoped file tools. Authentication belongs to the installed Claude Code CLI. The repository's Forge case study records real Claude exchanges.
- **OpenAI (`openai`)** makes one Responses API request with strict structured output and no tools. It reads `OPENAI_API_KEY` from the coordinator environment; a ChatGPT or Codex login is not automatically an API credential.
- **Gemini (`gemini`)** makes one `generateContent` request with JSON schema output and no tools. It reads `GEMINI_API_KEY`, falling back to `GOOGLE_API_KEY` when the first is absent.
- **Ollama (`ollama`)** makes one chat request to a server you already operate, using JSON schema output. Its default is `http://127.0.0.1:11434`. Select a model already available on that server. No Claude or cloud account is needed for an unauthenticated local server.

API jobs receive only selected UTF-8 text files, including existing output files. They cannot browse your repository, execute tests, use MCP, view images, or call tools. They return a summary and complete file contents, which the runner validates before writing into the copied workspace. The coordinator still reviews and integrates them. UI review recipes evaluate supplied source or written flows, not rendered screenshots.

## Check setup without sending context

```sh
node tools/swarm.mjs doctor all
node tools/swarm.mjs doctor openai
node tools/swarm.mjs doctor gemini
node tools/swarm.mjs doctor ollama
```

`doctor` without an argument checks Claude for backward compatibility. `doctor all` reports each provider independently. API `configured` means an environment credential is present, or an Ollama origin has been selected. `liveVerified: false` is deliberate: diagnostics do not contact endpoints or prove authentication, model access, server health, quota, or output-schema support. `run` checks only the providers its jobs actually select.

Configure credentials using your normal secure environment/secret manager, outside the worker. Never put real keys in a manifest, command example committed to Git, prompt, or copied context. The runner does not read `.env` automatically. If you choose Node's environment-file feature, keep that file outside version control and never include it as context. API account access and billing are separate from cloning this public repository.

For Claude installation, follow [Anthropic's setup guide](https://code.claude.com/docs/en/setup), authenticate through the CLI, and run the compatibility check. Required restrictions are never silently removed to support an older CLI.

## A bounded first exchange

Read and adapt one example before executing it. The example model names are starting points, not a claim of availability on your account. Use a model supported by your provider with structured JSON output; for Ollama, select an installed model capable of following the schema.

```sh
node tools/swarm.mjs validate examples/openai-smoke.json
node tools/swarm.mjs run examples/openai-smoke.json
# Alternatives: examples/gemini-smoke.json or examples/ollama-smoke.json
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
```

Each API smoke has empty context, one declared Markdown output, a 1,024-token output limit, and a two-minute timeout. Review the proposed file and summary, then integrate. For a read-only smoke, change `outputs` to `[]` and ask for an acknowledgment in the summary. Installed copies use `coordination/swarm-openai-smoke.json` (or the corresponding provider name).

The three API adapters have deterministic mocked-transport tests covering their contracts and failure handling. They have **not been verified against live cloud credentials or a live Ollama model as part of this release**. A passing test or doctor result is not such verification. Record your own observed resolved model and successful read-only/writing exchanges before assigning substantial work. Missing model metadata stays null rather than being inferred.

## Limits, cancellation, and errors

All API jobs must name `model`. `maxOutputTokens` defaults to 8,192 and accepts 256–32,768; choose a smaller value for simple tasks. Provider reasoning may consume output allowance. Incomplete, refused, malformed, oversized, or wrongly scoped output fails the job; partial files are not accepted. There are no automatic retries.

Concurrency defaults to 2 and can be explicitly set from 1 to 16 across providers. More concurrent jobs can increase resource load and simultaneous charges. Tokens and timeouts are not dollar budgets. Cancellation aborts the local HTTP request and response reading, but remote work or charges may already have occurred. API cost is recorded as unavailable, not calculated from assumed prices.

HTTP failures record a status and omit the response body. Transport and response-stream exceptions are sanitized; request headers and raw API responses are not logged. Read-only summaries and generated files can still contain supplied source. Keep `.swarm/` private. For authentication errors, check the selected provider's account/environment setup outside the runner; for schema errors, verify the chosen model's structured-output capability. Do not weaken file validation as a workaround.

## Endpoints and local models

OpenAI and Gemini use fixed HTTPS endpoints. Arbitrary base-URL environment variables are intentionally ignored, and manifests cannot specify endpoints. Redirects are refused, including same-origin redirects, to avoid forwarding credentials to another destination.

Ollama accepts an optional **operator-controlled** `SWARM_OLLAMA_URL` containing only an origin, for example `http://127.0.0.1:11434` or an explicitly trusted `https://models.example.com`. HTTP is allowed only for the exact loopback hosts `127.0.0.1`, `[::1]`, and `localhost`; remote hosts require HTTPS. Credentials in URLs, query strings, paths, and fragments are rejected. `OLLAMA_API_KEY`, if present, is sent only to the selected Ollama origin. Setting a remote origin explicitly trusts it with your copied files and that key. DNS, machine policy, and remote service ownership are not authenticated by this toolkit.

This is an Ollama chat/schema adapter, not a universal OpenAI-compatible proxy adapter. It does not assume every local model supports JSON schema reliably. If local inference is slow, first reduce input/output scope and concurrency rather than disabling validation.

## Official protocol references

Implementation references, reviewed for this release:

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format` with a JSON schema; the adapter sets `store: false` and provides no tools.
- [Gemini generateContent reference](https://ai.google.dev/api/generate-content): model-scoped requests, `generationConfig.responseMimeType`, `responseJsonSchema`, candidate finish reason, and usage metadata.
- [Ollama chat API](https://docs.ollama.com/api/chat): `stream: false`, schema-valued `format`, message content, completion state, and token counts.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference): fixed restricted CLI flags and structured result events.

Provider behavior, models, and account access can change. Keep compatibility checks and real smoke verification separate from mock unit tests.
