# Connector and agent-village swarm study

This is a working study from a real product build on September 17, 2026. It records observed behavior and tested changes. It is not a controlled speed benchmark. Private application prompts and source, customer information, and provider transcripts remain outside this package. The included toolkit manifests contain reviewed toolkit-only prompts.

## Observed workload

The initial connector work ran seven CLI workers across four overlapping cohorts: shared credentials/accounts, provider adapters, setup/connections UI, and inbox isolation. The observed aggregate peak was seven workers. Each cohort integrated as a whole; splitting manifests reduced the failure blast radius but required the coordinator to track aggregate concurrency and ownership across runs.

The shared-account job owned 11 outputs covering account storage, refresh, grants, execution gates, archive behavior, status, and tests. It completed in 1,467,649 ms (24m28s). Its paired shared-key job completed in 949,690 ms (15m50s). The faster job therefore waited about 8m38s before its cohort could be eligible for integration. That delay is observable; the amount a different plan would have saved is unknown.

The provider cohort had a similar imbalance: one job completed in 949,325 ms and the other in 1,413,593 ms. Workers returned actual model metadata `claude-opus-5[1m]`. These times include provider/tool processing; they do not measure productive reasoning. Reported costs are provider estimates, not audited invoices.

The subsequent agent-village feature first used three concurrent implementation jobs with fixed interfaces: landscape/art, renderer/choreography, and UI controls/styles. An independent reviewer identified concrete refresh, mobile fullscreen, and cleanup risks while implementation continued. Run `1789671905306-7d18ee01` failed: art timed out after 1,200,318 ms and motion after 1,200,394 ms, against a 20-minute limit. The UI job completed in 857,336 ms (14m17s), but none of this failed cohort was integrated. A completed worker is not a completed integration cohort.

Recovery separated scenery into two independently testable modules with one resource owner each. Run `1789674051065-cf58713e` delivered ground in 184,225 ms (3m04s); run `1789674101225-7c4e728c` delivered buildings in 291,212 ms (4m51s). Both one-job cohorts were reviewed and integrated independently. Their recorded lifetimes overlap. Each returned the same resolved model metadata as the earlier jobs, `claude-opus-5[1m]`. The upgraded runner recorded output counters and timestamps for both recoveries; the first village cohort had no progress fields.

A native subagent freshly implemented scene integration and then the UI reliability corrections in explicitly owned current-source files. No failed proposal files were copied. The coordinator composed the two scenery modules and retained browser acceptance. These are distinct delivery mechanisms: the native changes are not represented as successful CLI runs.

The smaller art jobs delivered coherent modules after the larger cohort timed out. That is an observation about this recovery, not a speedup estimate: scope, scheduling, and implementation strategy changed, and no matched or sequential control exists. Separate cohorts also prevented one art job's completion from depending on the other's success.

## Iteration 1: observable activity

Baseline monitor records exposed start/finish lifecycle but no mid-run output signal. The first toolkit cohort added throttled CLI byte counters and first/last output timestamps, with no worker prose in the progress fields. Non-streaming API calls remain explicitly unobservable. A quiet worker may still be reasoning; bytes do not prove correctness or productivity.

Coordinator review found two failure-path gaps: rejected asynchronous progress saves could escape handling, and startup failure could skip tracker cleanup. Follow-up regression work covers those cases before the upgrade is accepted.

## Iteration 2: task sizing before dispatch

The preflight report exposes per-file context size, repeated context, output counts, and cross-job output/input relationships. Advisory thresholds are triage signals, not proof that a job is too complex. The skill now asks the coordinator to define one coherent deliverable and acceptance check, split independent concerns, preserve one writer per file, and use smaller integration cohorts where appropriate.

When one job needs another's changed file, inputs are still the original copied snapshot. Concurrency one does not create an in-run handoff. Integrate the producer before starting the dependent consumer, or use an agreed stable interface contract and verify the composition afterward.

A read-only manager can propose assignments and check a plan. Restricted CLI workers do not acquire spawning or shell access. The coordinator validates the proposal and dispatches the actual workers.

## Iteration 3: forward evaluation and integration

An independent native manager delegated a forward-planning evaluation while writing the manager recipe. The evaluator covered all eleven original abstract source files with six staged jobs, at most three owned files per job, and no duplicate owners. Its plan correctly sequenced dependent interfaces before parallel consumers. It deferred too much regression work to the final stage, so the skill was revised again: bind a runnable check and a test owner before each cohort starts. Manager handoffs now include ready/fix/blocked disposition with evidence and scope stop conditions. This is a planning improvement, not measured delivery speedup.

The upgraded runner then ran an actual independent Claude review, run `1789672439641-362cda77`. It completed in 360,625 ms with resolved model `claude-opus-5[1m]`. During execution, monitor reported live byte/timestamp changes; final stdout counted 310,140 bytes and stderr zero. API liveness is still unverified because this was a CLI run.

That review reproduced orphaned temporary state files and installer gaps around duplicate destinations and interrupted writes. Fixes now clean up atomic-write temporary files, reject duplicate install destinations before mutation, create/recheck parent components, and roll back only owned files and empty created directories while preserving the original failure. This is guarded local filesystem behavior, not an OS security sandbox. The review also prompted an explicit CLI regression and documentation that valid advisory reports exit zero even when review is required.

The reviewer suggested stat-only sizing. That suggestion was not applied: preflight deliberately preserves full execution validation, including API UTF-8 checks. Repeated large files therefore still incur repeated local reads. This tradeoff is documented rather than hidden.

## Scoped manager review in the product work

A native connector area manager reviewed and integrated three whole successful cohorts, then delegated bounded credential-verification and connection-storage corrections to a native worker under disjoint ownership. The manager checked actual worker results and source, rather than treating a completion message as proof of tests. Original CLI workers reported that their tests were authored, not executed.

The final area review found a grant-versus-archive race. Deterministic local PostgreSQL wait-graph tests reproduced four failures in each affected suite: connection sharing was 103 passed / 4 failed and setup 221 passed / 4 failed. Consistently ordering source and recipient venture locks before ownership checks and credential/account locks fixed those cases. The same suites then passed 107 / 0 and 225 / 0. Other focused checkpoint results were workspace connectors 108 / 0, model connectors 105 / 0, existing connections 75 / 0, and workspace chat guards 39 / 0. Provider calls were mocked, and database fixtures were scoped to the verified local host.

This is a concrete manager-quality use case: a domain owner coordinated shared interfaces, requested reproducible concurrency evidence, and checked a fix across both credential and account paths. It does not measure manager productivity or establish a general defect-rate improvement. Execution-environment failures were retained as failures: one CLI correction could not reach its provider, its retry lacked required restriction flags, and a separate attempt was cancelled. Restrictions were not weakened, and those attempts were not counted as completed implementation.

## Product checkpoint after recovery

The coordinator executed eight scene checks covering the composed terrain and two disposal cycles. The structural inventory was 134 meshes, 1,096 instances, 30,438 geometry triangles, 36 distinct geometries, and 23 materials. These are CPU scene-graph/resource observations, not GPU draw-call counts, frame-time measurements, or proof of mobile rendering performance. Fifteen choreography checks passed, including larger-roster bounds, path continuity, bounded transition speed, and frozen motion.

Browser review confirmed populated and empty villages, narrow mobile layout, agent inspection and conversation access, camera controls, and the motion toggle. It found two photo defects that source review had missed: unsupported instanced geometry and a mixed RGB/RGBA merge bug in the installed ray tracer. A bounded native correction converts only the snapshot and preserves live resources. Six additional regressions cover expansion, transforms, ownership, and actual library merging in both geometry orders. All fourteen scene checks passed; the browser then showed correctly colored terrain at 128/128 photo samples.

The full product suite passed across 44 scripts before the final photo correction. After that correction, focused scene tests, combined type/lint/design/secret/agent checks, and the production build passed again. The local schema check passed. Temporary preview agents were removed and the empty village verified. Renderer-loss simulation and OS-level reduced-motion changes were not exercised; the tested motion toggle and graceful fullscreen rejection are narrower evidence. External OAuth account setup remains unconfigured and unverified, and nothing was deployed.

## Quality and speed measures

Measure feature elapsed time, time completed work waits for integration, context bytes, failed/time-out jobs, review defects, and fixes needed after integration. Count workers only as a capacity measure. Do not claim speedup, savings, or better quality from higher concurrency alone.

Review may begin when a worker finishes, even before the whole cohort settles: copied proposals are inspectable, but integration remains blocked until the full run succeeds. Run focused tests for each change and the shared project checks after integration. Test 3D behavior in the browser; source review alone cannot prove visual quality.

## Evidence and current limits

Sanitized metadata lives in `coordination/connector-study/evidence-baseline.json` and `coordination/connector-study/evidence-results.json`. The implementation manifests and raw logs of the private application are intentionally not published. The first village failure, both successful recovery cohorts, and the final local product checks are recorded in the results file.

No live external OAuth connection is claimed by this study. No sequential control was run. Deterministic fake-worker tests verify orchestration behavior, not live provider performance. The village's ambient movement does not report task progress or start external work.

## Final toolkit preflight

- Passed: all 76 deterministic tests, including progress failures, partial-install rollback, hazardous preflight CLI, and fresh/idempotent install.
- Passed: package syntax, reference links, skill metadata, examples, and license checks (51 files at this pass).
- Passed: skill quick validation and whitespace/diff check.
- Passed: live upgraded CLI review with actual output telemetry; reviewed response and successful provider result, no permission denials.
- Passed: independent manager forward evaluation with documented limits and follow-up corrections.
- Passed separately: product browser review, focused post-correction checks, combined verification and production build, with the unexercised cases above explicitly retained. Toolkit tests alone were never used as product acceptance.

See [orchestration](orchestration.md), [setup](setup.md), and [the security boundary](../SECURITY.md).
