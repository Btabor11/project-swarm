# Active orchestration

The coordinator turns the mission into reviewed changes. A list of imaginary workers is not a swarm run. Start only workers with concrete useful deliverables, record the run ID, and follow their work through verification.

## A practical operating loop

1. Inspect the actual project and its instructions. Identify the desired behavior, current implementation, shared interfaces, and relevant checks.
2. Split independent work into coherent deliverables, each with an acceptance check and one owner per output. A rendering change and its focused tests can belong to one worker; a separate worker can handle a disjoint navigation component. Keep exact shared interface decisions and final integration with the coordinator. Consumers of an unsettled interface belong in a later run.
3. Write a manifest naming explicit context and outputs. Use available providers and models. Choose concurrency based on useful independent work and account/machine capacity; the default is 2, explicit maximum 32, and up to 256 jobs may wait in the queue.
4. Run `preflight`, resolve dependency warnings, and review task-size advisories before actually starting `run`. `validate` is still available for validation alone. Preserve the execution session and run ID. The command stays attached; it does not create an unattended daemon or visible terminal windows.
5. While workers execute, continue independent coordinator work and periodically call `monitor`. The snapshot reports recorded queued/running/terminal counts, elapsed time, peak concurrent jobs, and per-job timings. Do not invent activity or call an idle process productive work.
6. Review each response and proposed file against the supplied evidence. Reproduce plausible defects. Reject unsupported claims. Inspect conflicts, then integrate the complete acceptable run.
7. Execute the target project's checks and inspect real behavior. For dependent follow-up, integrate the first stage and create a new manifest from the updated source.

```sh
node tools/swarm.mjs preflight examples/four-reviewers.json
node tools/swarm.mjs run examples/four-reviewers.json
# From a separate coordinator execution call while that owned run is active:
node tools/swarm.mjs monitor <run-id>
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
# Review every proposed output before integration.
node tools/swarm.mjs integrate <run-id>
```

The monitor is a single snapshot rather than a blocking watch loop. Poll at useful intervals (for example, 5–15 seconds for short runs and less often for longer ones); do not continuously busy-poll. Saved `running` state can be stale after a host crash. Timing measures runner job lifecycle, including startup/preparation and result handling; it is not GPU utilization or proof of productive reasoning.

CLI job progress includes observed stdout/stderr byte counts, first and last output timestamps, a sampled activity timestamp, and elapsed time without observed output (`silentMs`). These are output observations, not a heartbeat, semantic progress measure, or proof that a silent worker is stalled. Single-request API jobs mark incremental activity unobservable; older records without progress remain unknown. Do not invent timestamps for either case.

## Choosing a tier

One genuinely hard design problem, named in advance, goes to the expensive model. This section names it. Set each job's `tier` (`cheap` | `mid` | `expensive`) before dispatch and write a short `tierReason` for anything `expensive`; both are validated metadata (see [the manifest reference](manifest-reference.md)) and are shown back to you in `preflight` and `inspect`. Setting `tier` never selects a model by itself: put the model you actually want in `model`. Keep the wording short and plain.

- **`cheap`** — manifests, summaries, PR bodies, bookkeeping. Low stakes, easy to review, cheap to redo.
- **`mid`** — code and tests against a clear written contract. The default for ordinary implementation work once interfaces are settled.
- **`expensive`** — mark the task `expensive`, with a one-line `tierReason`, when it touches any of:
  - login, tokens, secrets, or another security boundary;
  - concurrency, async, event loops, or anything that runs at the same time as other code;
  - a contract between two repos, or a public API or file format;
  - a step a `mid`-tier worker already failed twice — escalate that one job one tier and record why in `tierReason` (for example: `"mid worker failed twice on the token-refresh race; escalating"`).

A design choice that is not already in the plan is not a reason to reach for a more expensive model. Stop and ask the human instead; no tier setting substitutes for that decision.

The runner has no retry/re-dispatch path today — every job in a manifest runs exactly once. The failed-twice escalation above is therefore a coordinator rule, not something the runner enforces: after a `mid` job's second failed attempt, the coordinator writes a fresh job with `tier: "expensive"` and a `tierReason` explaining the two failures, rather than dispatching a third `mid` attempt at the same task.

## Decompose before adding workers

A job that changes token refresh, persistence, revocation, runner behavior, scheduled work, archival, status, and their tests contains several concerns. First identify the stable interfaces and ownership boundaries. For example, settle a canonical account-access contract, then dispatch disjoint runtime callers and status presentation in parallel against that contract. Keep edits to a shared storage file with one writer; making several workers touch that file would create a merge bottleneck. Each job should state the behavior to deliver, files it owns, the acceptance check the coordinator will execute, and what must be true of its inputs.

Use small cohorts whose outputs can sensibly integrate together. An unrelated documentation task need not hold a ready code change behind the all-jobs-complete gate. Multiple independent runs can overlap, but the coordinator must ensure their output ownership does not overlap and account for total provider concurrency across runs. Preflight checks one manifest; it does not reserve files or detect other active runs. Review completed proposals while slower workers finish; do not bypass whole-run integration by copying files out manually.

Bind runnable acceptance evidence before dispatch. Name the existing check command and the behavior it covers, or assign a focused test file and its execution command. Implementation and its test may have the same owner; an independent test writer can work after the relevant API stabilizes. If the repository has one shared test file, use a serialized ownership handoff or first approve separate files supported by its test runner. Do not postpone all regression writing until one final broad testing job. The coordinator executes the cohort's checks after whole-run integration; worker-authored assertions and a proposed command do not count as passed tests. An integrated stage with missing or failing checks remains unverified, and dependent work must not assume its correctness.

Increase concurrency when more independent, useful work is ready and account capacity permits it. If workers are waiting on one unsettled contract, settle the contract rather than assigning more consumers to stale snapshots. A manager may help draft boundaries or review an area when that removes coordinator load. Restricted CLI managers have no agent or shell tools and cannot dispatch a nested swarm; the coordinator validates and starts their proposed manifests. An authorized native host manager can delegate bounded work when supported by the host, with those workers counted in the ownership and capacity ledger. This does not change the restricted runner's capabilities or grant new authorization.

Before dispatch, managers review ownership across active runs, required integrated dependencies, runnable acceptance checks, and task stop conditions. Return a concise disposition: **ready** with the inspected contract and check bindings, **fix** with the smallest correction and its evidence, or **blocked** with the unresolved dependency and required coordinator decision. After implementation, return the same disposition against actual files and check results; readiness to dispatch is distinct from verified acceptance. Stop the affected work when an unexpected shared-file edit, unsettled interface, missing context, failed check, or scope expansion would invalidate its contract. Managers report the issue rather than silently expanding outputs, permissions, budgets, or worker count. Independent work may continue within its existing scope.

See the [managed feature recipe](managed-feature-plan.md) for task contracts, ownership ledgers, and staged handoffs.

## What preflight reports

`preflight MANIFEST` performs the same manifest and project-path validation as execution, without calling a provider or creating a run. Invalid paths, missing context, reserved credential paths, symlinks, and ownership collisions still fail closed. Filename guards do not detect secrets inside ordinary source files; inspect the selected context before dispatch. A valid report includes:

- Per-job copied byte totals, every file's byte count and context/output role, and the five largest existing files. Existing output files count because workers receive those snapshots too; missing new outputs count as zero bytes.
- Repeated context across jobs, including copied existing outputs. Repetition may be needed for correctness; the report does not label those bytes wasted or estimate model tokens.
- Cross-job output-to-context references. Every job sees the pre-run snapshot, even at concurrency one. An exact stable contract can make parallel work valid; otherwise integrate the writer and create a fresh reader run.
- Advisory scope flags above five output files or 160 KiB of copied context. These heuristics ask for review; they neither reject a valid coherent job nor prove that a prompt contains multiple concerns. The coordinator must inspect the task's actual responsibilities.
- Each job's declared `agent`, `model`, `tier`, and `tierReason` (`null` when unset), so a tier decision is reviewable before dispatch instead of assumed. See "Choosing a tier" above.

The report is deterministic for unchanged inputs. It contains file paths and byte counts, but no source contents or prompts. It does not automatically split tasks, start workers, guarantee snapshot stability after the check, or predict speedup. The runner revalidates when execution starts.

## Observed bottleneck and how to evaluate changes

In the connector implementation study, a shared-account worker owned eleven files covering storage, token refresh, revocation, runtime callers, scheduled work, archival, status, and tests. It ran for 24 minutes 28 seconds. Its paired shared-key worker finished in 15 minutes 50 seconds, leaving its completed proposal waiting approximately 8 minutes 38 seconds for the cohort to become eligible for integration. Those are observed job durations and gate waiting; they are not a sequential baseline or evidence that adding workers would save the full waiting time.

That case motivates smaller coherent cohorts and earlier ownership/dependency review. To evaluate whether they help, record total time from dispatch through verified integration, each job's duration, waiting after completion, failures or retries, coordinator rework, and checks passed. Compare similar work with the actual input differences disclosed. Report unavailable usage or costs as unavailable and provider-reported costs as estimates. A higher peak worker count or an earlier model response is not by itself improved delivery.

Iteration counts should follow the user's task and the evidence. The connector skill-upgrade study uses three requested passes; ordinary work does not inherit a universal three-pass requirement.

## Scope and recovery

Jobs receive snapshots before execution. Setting concurrency to 1 does not create dependencies between jobs in the same manifest. Reports are untrusted suggestions, and generated code still needs review. Workers cannot authorize deployment, purchases, new tools, terminal attachment, or broad filesystem access.

A failed run cannot integrate. Correct the task, missing setup, or provider issue and start a fresh run. Cancellation stops the runner's owned processes/requests and prevents queued jobs from starting; it does not contact unrelated sessions or guarantee that a remote provider stopped billing. Do not start replacement workers until the cancelled run has settled.

Use recorded requested/resolved model fields, counts, and actual tests in the completion report. Missing usage/cost stays unavailable. Provider usage fields are aggregated within each provider only; different APIs count tokens differently.
