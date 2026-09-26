# 1.14.0 verification and next steps

Release checks use local fake workers, synthetic provider responses and
isolated temporary projects. They do not make model calls or publish a tag.

## Verified

| Command / action | Outcome |
| --- | --- |
| `SWARM_LIVE_DIR="$PWD/.swarm/test-live" npm test` | 403 passed; 0 failed, skipped or cancelled; 14 new release tests |
| `npm run check` | Passed: syntax, local links, packaging, license, skill and examples |
| `git diff --check` | Passed |

The default test invocation encountered denied access to the user-level live
registry. Setting `SWARM_LIVE_DIR` to an isolated directory under the worktree
avoids shared live-run state. No dependency or network access is required.

The release tests exercise denial-only completion and integration, warning
format and caps, other failures that must stay failed, missing results and
outputs, and retained changed workspaces. Redcheck tests exercise a real
regression assertion against base bytes, green results, each test filename
pattern, absent base files, executable modes, multibyte output tails,
conflicting edits, hash-verified git fallback, metadata and lock refusals,
launch errors, timeouts, signals, CLI exit codes and literal argv forwarding.

These checks are local and synthetic evidence. Live provider verification,
release tagging and publication remain separate work; a version bump is not
evidence that a release was published.

## Regression and mutation evidence

First run the new regression test with the fix and record the passing result.
Then run `node tools/swarm.mjs redcheck <run-id> --test <argv...>` and inspect
its tail: the intended assertion must fail against base code. A worker's claim
is not evidence, and an unrelated setup failure is not regression coverage.
Run the test again after restoration.

Add **one mutant per new guard before shipping**. In one field run, mutation
testing found three of four new guards untested despite the worker's own test
claiming to prove the fix. Remove or invert each guard independently, bind a
focused command, and inspect every mutant's failure. A surviving mutant needs
better coverage or a justified removal of the redundant guard. Use manifest
`mutants` and `mutantCheck` with `integrate --mutants --require-checks`; the
runner restores each mutation before the next. Redcheck proves sensitivity
to the old implementation, while per-guard mutants expose partially tested
new logic. See [mutation checks](manifest-reference.md#mutation-checks).

## Next

- Hard spend reservations, reliable cost reconciliation and runtime model
  availability mapping need a separate design.
- Enforce handoff counters and tracking-file freshness without overwriting
  project-owned instructions; currently these remain coordinator guidance.
- Isolate mutation runs and handle runtime caches before claiming protection
  from unrelated processes or abrupt host termination.
- Improve indirect test and fixture context discovery and undeclared-edit
  reporting.
- Adopt preserved failed worktrees only through a separately reviewed recovery
  flow; ordinary integration still refuses failed runs.
- Pin install snapshots used by live runs before promising safety across many
  successive upgrades.
