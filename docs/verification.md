# 1.13.0 verification and next steps

How the 1.13.0 release was checked before it shipped, and what is still open.

## Verified

Verified in an isolated HOME and temporary directories under the worktree's
ignored `.tmp-e2e/`, using a copy of this working tree's installable files.
The anonymized inputs were not copied. `INSTALL` and `PROJECT` below are
placeholders, not machine paths. Node was v24.20.0.

| Command / action actually run | Outcome |
| --- | --- |
| `node INSTALL/tools/install.mjs --user` | Installed 1.13.0; rendered shared skill available with neither Claude nor Codex home present |
| `node INSTALL/tools/install.mjs PROJECT` on a fresh empty project, then repeated | Seeded missing files; repeat kept all 18 coordination files; exactly one agent marker block per file; gitignore present |
| Same link and relink on a project with existing coordination and AGENTS.md | Preserved existing TASK.md and user instructions; added missing templates and pointers; repeat kept all seeds |
| `node INSTALL/current/tools/swarm.mjs --root PROJECT doctor all` on both projects | Eight provider reports and no tool warnings for these config-free fixtures; no model requests |
| `node INSTALL/current/tools/swarm.mjs --root PROJECT validate coordination/swarm-smoke.json` on both | Validated read-only and writing smoke jobs |
| `node INSTALL/current/tools/swarm.mjs version` | Reported 1.13.0 and the install root, not the version snapshot |
| `node INSTALL/current/tools/swarm.mjs --root PROJECT update` and `version` against a git project with a high-version tag behind HEAD | Both exited 1 with explicit refusal; HEAD and main branch unchanged |
| `runManifest` → `inspectRun` → `integrateRun` with an injected synthetic HTTP response | Both reader and writer completed; handshake integrated and read back; no external model request |
| `npm test` with isolated HOME, TMPDIR and SWARM_LIVE_DIR | 387 passed; 0 failed, skipped or cancelled |
| `npm run check` | Syntax, local links, packaging and example checks passed |
| `git diff --check` | Passed |

The regression tests failed against the original behavior for all six reported
kickoff defects. The first full test run was blocked by this worker's inability
to read the real user live-run registry. Moving HOME, TMPDIR and SWARM_LIVE_DIR
inside the worktree isolated it properly; this also exposed and led to the fix
for empty-index test discovery. A reference audit caught a missing installed
JSON example, now covered by an installer regression.

Local doctor probes were tested against an ephemeral HTTP server, a stopped
server, a timeout, and injected cloud transports that must never be called.
These checks distinguish configured from reachable without sending credentials.
This is local and synthetic proof, not a live model exchange or evidence that
the release tag has been published. The coordinator still owns live provider
verification, final mutation sign-off, release tagging and publication.

## Next

- Hard spend reservations across commands, reliable provider cost reconciliation,
  and runtime model availability mapping need a separate design.
- Enforce handoff counters and tracking-file freshness without overwriting
  project-owned instructions; currently the seat provides guidance only.
- Isolate mutation runs and handle Python caches before claiming clean restoration.
- Report empty research areas and zero-hit queries distinctly.
- Compare failures on base and branch, warn about undeclared changed files,
  and improve indirect test/fixture context discovery.
- Support explicit manifests outside the project, intentional independent branch
  experiments, and adoption of preserved worktrees through reviewed integration.
- Snapshot pruning keeps only the five newest plus current; pin snapshots used
  by live runs before promising safety across many successive upgrades.
- Add optional verification of dynamic/inherited tool configs; static warnings
  cannot prove how a framework collects files.

