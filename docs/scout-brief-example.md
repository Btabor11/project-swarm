# Example scout brief

A scout brief is plain text or Markdown describing the stack and constraints for the search — not the goal itself, which is the CLI's positional argument. Copy this file, replace the details, and pass it with `--brief`.

## Stack

- Language/runtime: Node.js 20, ES modules.
- HTTP client: the built-in `fetch`.
- No dependency may require a build step (native addons, WASM toolchains) or bring in a heavy transitive tree.

## Constraints

- Must work with no network access at runtime beyond the outbound calls it wraps.
- Must be usable from a single function call; no global registries or singletons.
- License must allow bundling into closed-source deployments without publishing source changes.

## What "drop-in" means here

A pick is `drop-in` only if it can replace the described logic with a single import and a small adapter — no forked internals, no monkey-patching.

## Out of scope

- Anything requiring a paid API key or SaaS account.
- Frameworks that dictate an application's overall structure; this brief is for one focused piece of logic, not a framework choice.
