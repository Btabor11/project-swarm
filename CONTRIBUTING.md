# Contributing

Contributions should keep Project Swarm small, inspectable, and explicit about its limits. Start with an issue or discussion describing the concrete problem, expected behavior, and relevant environment. For a private fork, use your team's normal review channel.

## Local development

Use Node.js 20.3 or newer. The runner has no runtime npm dependencies. Run the deterministic suite before proposing a change:

```sh
npm test
```

The unit tests must not require provider authentication, network access, or paid model calls. Use the test injection points for fake process behavior. Keep optional real-provider smoke exchanges separate and never commit their `.swarm/` records.

## Change expectations

- Keep worker execution fresh, explicit, and detached from unrelated terminals or sessions.
- Preserve strict manifest validation, explicit file ownership, symlink/path checks, and conflict detection before integration.
- Use fixed adapter commands with `shell: false`; do not add arbitrary executable or environment fields to manifests.
- Add focused regression tests for changed behavior, especially cancellation, malformed provider output, conflicts, file modes, or installation.
- Update the skill, examples, and documentation when command behavior or guarantees change.
- State what was actually tested, including operating system and provider versions for optional live checks.
- For improvements discovered in product work, include a sanitized reproduction and preserve the distinction between observed results and expected gains. Follow [learning from real work](docs/learning-from-work.md); do not publish private project context or require an unrelated toolkit change after every task.

For changes to the portable installer, test a fresh install, an identical repeated install, and refusal to overwrite differing existing files. For a new provider, follow [the adapter checklist](docs/extending.md) and do not advertise support before its restrictions and real smoke exchanges have been verified.

## Pull requests

Explain the concrete problem, resulting behavior, and validation. Include important limitations or compatibility changes. Keep unrelated refactoring separate so reviewers can assess the changed capability.

AI-assisted contributions are welcome. The contributor remains responsible for reviewing generated code, respecting third-party licenses, and providing real validation. Do not claim that a worker ran a check unless it actually had that capability and the result is available.

By submitting a contribution, you agree that it is provided under this repository's Apache License 2.0. Do not submit secrets, customer code, private logs, or material you are not authorized to contribute.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Before publishing a contribution

Use your own GitHub-provided private commit email if you do not want your personal or work email in public history. Find the exact address in [GitHub email settings](https://github.com/settings/emails), enable email privacy and push blocking, then set `git config --local user.email "YOUR_GITHUB_NOREPLY_ADDRESS"` in this checkout. Changing this setting affects future commits, not existing history. Do not replace another contributor's identity or rewrite shared history without coordination.

Keep case studies anonymous unless you have permission to identify the project. Exclude customer data, private source, internal paths, business-specific limits, and private transcripts. Review release descriptions and attachments as well as tracked files.

`.gitignore` and the package checker are not secret scanners. Run a dedicated scanner such as `gitleaks git . --log-opts=--all --redact` before publishing and keep repository secret scanning and push protection enabled. A clean scan means no supported patterns were detected; it does not prove there are no secrets or confidential details. Use synthetic credentials in tests.
