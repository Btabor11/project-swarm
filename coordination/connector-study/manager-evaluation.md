# Manager and task-sizing forward evaluation

Recorded 2026-09-17. This is a local planning evaluation against a realistic feature request. It is not an implementation benchmark, test of live providers, or measurement of delivery speed.

## Actual delegation

The root coordinator assigned a bounded evaluation manager. That native manager delegated one read-only evaluation to `/root/swarm_eval_manager/forward_plan` while independently writing `docs/managed-feature-plan.md`. The child read the project-swarm skill and orchestration guide and returned a proposed plan. No source implementation, provider credentials, production data, network requests, or deployments were involved. The host supported this authorized native child delegation; no restricted CLI worker spawned another worker.

The evaluation prompt supplied the request to implement shared accounts across ventures, covering storage, canonical token refresh, sharing/revocation, runtime callers, venture archival, setup status, and tests. It supplied only these eleven abstract source paths:

- `lib/connections/store.ts`
- `lib/connections/sharing.ts`
- `lib/connections/adapters/connection-auth.ts`
- `lib/connections/adapters/ms365.ts`
- `lib/connections/adapters/outbound.ts`
- `lib/connections/adapters/oauth.ts`
- `lib/agents/runner.ts`
- `lib/cron/agent-digest.ts`
- `lib/ventures/manage.ts`
- `lib/setup/status.ts`
- `scripts/connection-sharing.test.ts`

The child was asked for bounded jobs, explicit ownership, acceptance checks, stage ordering/dependencies, manager responsibilities, and concurrency criteria. It was told to inspect source before eventual execution and not invent source contents. It was not given a target number of jobs, an intended decomposition, or expected findings.

## Returned plan

The evaluator proposed six implementation jobs:

1. Storage and access lifecycle: store and sharing, two files.
2. Credential lifecycle: connection-auth, ms365, and oauth, three files; after job 1 integrates.
3. Runtime consumers: outbound, runner, and agent-digest, three files; after jobs 1 and 2 integrate.
4. Venture archival: manage, one file; after the account/auth contracts integrate.
5. Setup status: status, one file; after the account/auth contracts integrate.
6. Cross-feature regression coverage: connection-sharing.test, one file; after jobs 1–5 integrate.

The returned ordering was `1 → 2 → {3, 4, 5} → 6 → final validation`. It required fresh snapshots after prerequisite integration, rejected using concurrency one as dependency sequencing, and retained whole-run integration. It suggested starting with concurrency two, increasing to three when all consumer jobs are useful and capacity is confirmed. It assigned the coordinator contract decisions, manifests, checks, review, monitoring, and integration.

The evaluator explicitly qualified its proposal: implementation had not been inspected, ownership assumptions required confirmation, and no providers or checks had run.

## Assessment

**Ownership: pass for the supplied abstract paths.** Every supplied file had exactly one proposed writer; no file was omitted or duplicated. The largest proposed file set was three, compared with the original eleven-file task. File count alone does not establish appropriate effort or independence.

**Dependencies and concurrency: pass at the planning level.** The plan did not claim consumers could see unfinished writes and did not invent nested CLI dispatch. It treated three consumer jobs as concurrency candidates only after their shared contracts integrate. This is a safe conservative proposal, not proof those boundaries match the actual source.

**Behavior coverage: pass at the planning level.** The checks covered authorized/unauthorized access, revocation, canonical refresh, partial failure, runtime fallback isolation, archive behavior, and status without credential exposure. Product semantics such as whether a source venture's archive invalidates recipients still require a concrete coordinator-approved contract.

**Actionable checks: incomplete before dispatch.** The evaluator correctly avoided inventing a test command, but the proposal did not bind each stage to a known executable command or a newly owned focused test file. It deferred the shared regression file until the final stage and said earlier stages should use available checks. If those checks do not exist, early implementation stages would not yet have sufficient validation. The manager must inspect the actual runner and assign stage-specific tests or a serialized handoff to the test owner before launch. Prose acceptance assertions are not passing tests.

**Manager responsibilities: partial.** The proposal clearly kept integration and dispatch with the coordinator but did not define a concrete ongoing area-manager review output, stop conditions, or ownership ledger. The accompanying recipe adds those contracts without granting a restricted worker agent or shell capabilities.

**Potential remaining bottleneck: unresolved.** The three-file runtime consumer job may contain separable adapter, interactive, and scheduled behaviors. Source inspection should decide whether independent checks and settled interfaces justify splitting it. Splitting by file alone could create extra handoffs without improving delivery.

## Improvements from this evaluation

`docs/managed-feature-plan.md` records a manager task contract, an ownership ledger across all runs, stage handoffs, explicit stop conditions, and independent review evidence. It explains native delegation separately from the restricted CLI manager's proposed-plan output. It requires an exact existing check or approved focused test ownership before claiming an implementation stage is validated.

The instruction author was sent the specific deficiencies: delayed test ownership, missing executable stage checks, and incomplete manager handoff responsibilities. This feedback is based on the actual returned plan, not a claimed failure of code that was never implemented.

## Limits

One evaluator and one abstract task are a useful forward check, not a representative benchmark. No control plan from the older skill was generated in this evaluation. No actual feature work was executed by the child, no validation commands ran, and no speedup, quality gain, cost reduction, or defect reduction was measured. The result supports clearer safe planning boundaries only. Subsequent real feature work should record dispatch-to-verified-integration time, integration waiting, retries, rework, checks, and unresolved defects before claiming performance improvements.
