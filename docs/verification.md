# 1.15.0 verification and next steps

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

## Flake on base

A failing check with `repeat` reruns the same argv, with the failing test file
appended, against a temporary checkout of the run's base commit (N times, N
from `repeat` or the check's own `flakeRuns`, capped at 20). The result gains
`flakeOnBase: {file, failed:k, runs:N}` and a `flake on base: k/N (<file>)`
line next to the failure; `k > 0` means the flake already existed on base, not
a regression the run introduced. This never changes the check's pass/fail; it
only tells a coordinator whether a hand-run repro loop is still needed. Pass
`--no-flake-check` to `integrate`/`ship` to disable it. See
[manifest reference](manifest-reference.md#flake-on-base).

## Redcheck against an explicit base

`redcheck --base <ref>` restores non-test outputs from `git show <ref>:<path>`
instead of the run's own recorded base. When `--base` is omitted and the run's
base commit is not an ancestor of the default branch tip, the result adds
`suggestBase: 'origin/main'` (or the actual default-branch ref) and a warning
that old code on the default branch may already contain the change — the case
that produced a false green result on a follow-up job whose base commit had
already picked up the fix. See
[manifest reference](manifest-reference.md#redcheck).

## resultFile

A job may declare `resultFile` (one of its own `outputs`, with optional
`resultSchema` listing required keys) so `inspect --results` reads that file
directly instead of depending on the worker's last message being valid JSON.
`result` then comes from the file, `resultSource` reports which source
answered (`'file'` or `'message'`), and mismatches or parse/schema problems
surface as warnings rather than silent nulls. See
[manifest reference](manifest-reference.md#result-file).

## Mutation tooling pointer

`ship ... --require-section 'Mutation check'` warns
`no manifest mutants: declare "mutants" in the manifest and run "integrate
--mutants" (see docs/verification.md)` when the run's manifest declares no
`mutants` — ship still continues, but the mutation-check requirement no
longer goes unanswered without at least naming the existing tooling. Declare
mutants and run `integrate --mutants` instead of hand-writing a mutation
script; see [mutation checks](manifest-reference.md#mutation-checks).

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
