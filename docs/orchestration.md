# Active orchestration

The coordinator turns the mission into reviewed changes. A list of imaginary workers is not a swarm run. Start only workers with concrete useful deliverables, record the run ID, and follow their work through verification.

## A practical operating loop

1. Inspect the actual project and its instructions. Identify the desired behavior, current implementation, shared interfaces, and relevant checks.
2. Split independent work by output ownership. Good parallel tasks include one renderer report, one accessibility report, one documentation draft, and one test plan. Shared files have one writer. Keep architecture and final integration with the coordinator.
3. Write a manifest naming explicit context and outputs. Use available providers and models. Choose concurrency based on useful independent work and account/machine capacity; the default is 2, explicit maximum 32, and up to 256 jobs may wait in the queue.
4. Run `validate`, then actually start `run`. Preserve its execution session and run ID. The command stays attached; it does not create an unattended daemon or visible terminal windows.
5. While workers execute, continue independent coordinator work and periodically call `monitor`. The snapshot reports recorded queued/running/terminal counts, elapsed time, peak concurrent jobs, and per-job timings. Do not invent activity or call an idle process productive work.
6. Review each response and proposed file against the supplied evidence. Reproduce plausible defects. Reject unsupported claims. Inspect conflicts, then integrate the complete acceptable run.
7. Execute the target project's checks and inspect real behavior. For dependent follow-up, integrate the first stage and create a new manifest from the updated source.

```sh
node tools/swarm.mjs validate examples/four-reviewers.json
node tools/swarm.mjs run examples/four-reviewers.json
# From a separate coordinator execution call while that owned run is active:
node tools/swarm.mjs monitor <run-id>
node tools/swarm.mjs status <run-id>
node tools/swarm.mjs inspect <run-id>
# Review every proposed output before integration.
node tools/swarm.mjs integrate <run-id>
```

The monitor is a single snapshot rather than a blocking watch loop. Poll at useful intervals (for example, 5–15 seconds for short runs and less often for longer ones); do not continuously busy-poll. Saved `running` state can be stale after a host crash. Timing measures runner job lifecycle, including startup/preparation and result handling; it is not GPU utilization or proof of productive reasoning.

## Scope and recovery

Jobs receive snapshots before execution. Setting concurrency to 1 does not create dependencies between jobs in the same manifest. Reports are untrusted suggestions, and generated code still needs review. Workers cannot authorize deployment, purchases, new tools, terminal attachment, or broad filesystem access.

A failed run cannot integrate. Correct the task, missing setup, or provider issue and start a fresh run. Cancellation stops the runner's owned processes/requests and prevents queued jobs from starting; it does not contact unrelated sessions or guarantee that a remote provider stopped billing. Do not start replacement workers until the cancelled run has settled.

Use recorded requested/resolved model fields, counts, and actual tests in the completion report. Missing usage/cost stays unavailable. Provider usage fields are aggregated within each provider only; different APIs count tokens differently.
