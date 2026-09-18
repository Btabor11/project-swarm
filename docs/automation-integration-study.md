# Automation integration study

This case used the project-swarm coordination workflow with three authorized
native workers and one coordinator in Cluer CRM. It did not run the toolkit's
restricted CLI adapters. Four native slots were available; no nested managers
were launched because there were only three independent implementation lanes.
The toolkit's adapter capability and isolation claims are unchanged.

## Task boundaries and checks

The first cohort separated execution reliability, unified history, and durable
task dispatch. The coordinator owned shared schema/interfaces and recurring
mission discovery. Explicit contracts connected `StartRunInput.commandId`,
instruction ancestry/source fields, and transactional `enqueueInstruction`.
The history worker then took the mission controls after those APIs stabilized.
This staged handoff reused a worker without assigning two writers to one file.

The implementation checks used disposable local database fixtures and fake
provider transports. History checks covered cursor precision and tenant scope;
executor checks covered replay, budgets, pause/cancellation, and provider
failures; dispatcher checks covered duplicate claims and bounded retry. A
subsequent worker independently reviewed mission discovery. A third pass
tested the full mission → manager → worker → review path using the real
execution functions and a controlled provider. Its 22 checks passed, including
a provider failure after a task write, replay without a duplicate task, an
approval wait, and a terminating manager review.

## What the review changed

- Separate task and schedule tests did not establish shared per-agent
  exclusion. Review identified overlap across entry points; admission now
  serializes on the agent row before inserting a running model loop.
- Limiting discovery before filtering enabled configurations allowed paused
  ventures to starve later ones. The query filters eligible settings first
  and rotates blocked settings through its bounded scan.
- Two tool names were insufficient evidence of orchestrator readiness.
  The readiness check now requires the tools used to discover workers and
  inspect actual CRM evidence.
- A model response does not prove the requested action happened. The product
  distinguishes a recorded response, a dry run, a pending approval, and a
  reviewer checking persisted tool results and CRM records.
- A later independent review identified a narrower crash window that the
  provider-failure test did not cover: the database write could commit before
  its replay log was saved. The release was held for an atomic receipt fix and
  a focused test that retries without the separate call log. Failure injection
  should target transaction boundaries as well as provider failures when a
  feature adds automatic retry.

These are concrete defects or contract gaps found during this implementation,
not a benchmark claiming a percentage speedup. No matched sequential baseline,
native-worker cost totals, or end-to-end latency distribution was collected.
More concurrent workers alone would not prove improved delivery.

## Reusable decision rule

When several workers implement different parts of an asynchronous workflow,
bind one independent integration acceptance job after their interfaces settle.
That check should cross the actual producer/claim/executor/completion boundary,
not replace each part with a stub. Mock only the external provider or service
when the aim is to avoid spending money or touching real customer data.

Record the actual acceptance command, exit status, and uncovered failures in
the consuming project's release evidence. A test plan or a worker's proposed
command is not a passing result. Installing a skill or publishing code is not
evidence that a live provider is configured or that production autonomy is on.

The user requested three passes for this project. This case does not impose
three passes on every task or authorize new production actions.

## Mission readiness follow-up

On 2026-09-17, the next CRM implementation used the same three-worker native
cohort: one worker owned team preparation and activation, another owned the
setup interface and model-check coverage, and the third owned a dedicated
worker prompt, dispatch eligibility, and independent lifecycle acceptance.
The coordinator owned shared discovery checks, provider verification, and
release integration. This remained native host delegation, not a toolkit CLI
adapter run or an experiment comparing delivery speed.

The earlier release could report a manager ready without an eligible worker.
Its existing research and monitoring prompts also did not establish a worker
for all three standing missions. Reviewing the bundled prompts exposed this
gap; broad tool lists on test fixtures would have hidden it. The follow-up
added a bounded CRM worker and checked the manager-to-worker chain using each
agent's effective permissions and configured route.

Preparation and activation were separate product operations. Preparation
installed two paused agents or refreshed their prompt metadata while preserving
existing levels, tool lists, model choices, budgets, and schedules. Explicit
owner activation refused custom access instead of overwriting it, kept the
write kill switch authoritative, and refused a ceiling increase that would
also expand another agent's access. Repeat-setup tests checked that these
controls and the discovery cursor survived reuse.

A configured key was not treated as a working model. The connection check
performed a synthetic tool call and consumed its result without sending CRM
records or invoking a CRM tool. Its proof was bound to the venture, credential
identity, and selected model, with an expiry. Tests rejected changed models,
rotated keys, wrong tools, wrong arguments, failed result handling, and copied
proof from another venture. Independent review also found the older settings
save path needed the same proof gate as the new activation button.

Observed focused checks in the consuming CRM at this stage were:

- `scripts/agent-mission-setup.test.ts`: 39 checks passed for preparation,
  preserved controls, verification-gated activation, and repeat activation.
- `scripts/agent-mission-model-check.test.ts`: 27 checks passed for synthetic
  provider verification and venture-scoped, content-free progress reporting.
- `scripts/agent-dispatch.test.ts`: 29 checks passed, including worker
  eligibility in the durable handoff.
- `scripts/agent-prompts.test.ts`: 99 checks passed against bundled prompt
  contracts, including the dedicated mission worker.
- `scripts/agent-mission-acceptance.test.ts`: 17 checks passed across all three
  mission signals, using actual preparation, verification, activation, durable
  queue, worker, and review functions with a controlled provider.

An independent forward-test applied the revised skill to a support-ticket
scenario with a configured manager and three specialist workers. The evaluator
identified the eligible worker, required checks against the bundled prompts
and effective permissions, selected a synthetic tool/result round trip, and
kept preparation, activation, and outcome claims separate. This observed the
intended decisions on a different scenario; it did not measure live support
outcomes or compare delivery speed against the previous skill.

These were local database fixtures and controlled provider transports. The
counts record executed checks, not proof of production credentials, successful
customer outcomes, or a measured speedup. Full release checks and production
verification belong in the consuming project's release evidence; publishing
this study does not imply they have passed. A paused team is
prepared; a saved enabled configuration is activated; recorded queue/run
events establish execution; the resulting CRM records establish the outcome.
