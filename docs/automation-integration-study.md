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
subsequent worker independently reviewed mission discovery. A third pass was
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
