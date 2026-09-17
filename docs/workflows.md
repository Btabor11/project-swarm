# Coordination workflows

The coordinator owns the outcome. Workers receive small assignments with enough context to answer or edit independently. Keep design choices, task boundaries, review, integration, and final validation with the coordinator.

## Ask an agent to operate the swarm

After installation, a practical instruction is:

> Read `skills/project-swarm/SKILL.md`. Use this project's swarm runner to improve checkout accessibility. Choose independent tasks, create and validate the manifests, and actually launch the workers. Monitor them until completion, inspect every response and proposed change, reject unsupported findings, integrate acceptable outputs, and run the project's relevant tests and browser checks. Use up to four concurrent workers if there are four useful independent tasks; keep one writer per output file. Handle routine follow-up work autonomously. Do not contact existing terminals or unrelated agents. Report which models actually answered and what you verified.

For a first use, ask for a read-only review before authorizing implementation. The coordinator should show which provider and model actually answered, what it accepted or rejected, and which tests it ran.

## Get useful parallel work

Start from the outcome and split the work by independent questions or file ownership. A strong set might contain an implementation worker for a component, a separate test-file writer, an accessibility reviewer, and a pricing-integrity reviewer. Give each the relevant interfaces and acceptance criteria. Reviewers may share read context; writing jobs must own different outputs.

Use the smallest context that is sufficient, not the entire repository. Ask for exact source evidence and require workers to distinguish demonstrated defects from hypotheses. Source-only UI reviewers cannot judge rendered pixels; reserve browser checks and visual judgment for the coordinator.

The default concurrency is two. Version 1.2 permits up to 32 simultaneous jobs and 256 total jobs per manifest, but a larger number does not create more independent work or guarantee faster results. The website case demonstrated six real Claude workers at once. Start with two to four meaningful tasks, then increase only when your workload, machine, account limits, and review capacity justify it.

## Parallel independent reviews

Use `examples/parallel-review.json` in the standalone checkout, or `coordination/swarm-parallel-review.json` after installation, as a starting point. Assign one worker a narrow rendering review and another a motion or accessibility review. Both can read the same source files. Give their reports distinct output paths, or use empty `outputs` arrays for responses only.

Good assignments request evidence:

> Review the supplied renderer for unnecessary framebuffer reallocations. Identify the exact code path, explain when it runs, and distinguish demonstrated defects from performance hypotheses. Do not edit the renderer or claim measured timings.

Reviewers do not automatically agree with each other, and their responses are not votes. Reproduce each actionable claim and document the decision. The [website case study](case-study.md) includes both accepted and rejected findings.

## Parallel implementation

Split by independent output ownership, for example:

- One worker edits `src/components/ProductCard.tsx` and its stylesheet.
- Another writes documentation in `docs/product-card.md` using the existing interface as context.
- The coordinator owns shared tokens, integration, and application tests.

Do not assign the same output path to two jobs. Avoid jobs whose output paths overlap as files and directories. The runner rejects these collisions within a manifest.

The coordinator must also avoid editing a worker's owned outputs during the run. Separate manifests do not create a universal scheduling lock; coordinate ownership across all active runs yourself. Integration's base-hash check catches changed outputs but cannot decide how two conflicting implementations should be combined.

All workers receive snapshots taken before execution begins. Job B cannot consume Job A's new changes merely because the manifest lists B later or uses `concurrency: 1`. Integrate A, then create a fresh run for dependent work.

## Review, improve, repeat

1. Validate the manifest and run the jobs.
2. Inspect each response and proposed file.
3. Check the claims against source or reproduce them in the application.
4. Integrate only after the full run succeeds and all outputs are acceptable.
5. Run application tests and inspect the user-facing result.
6. Write a new bounded assignment for any remaining issue.

While a run is active, use `node tools/swarm.mjs monitor <run-id>` for progress and `status <run-id>` for its saved details. Use `inspect <run-id>` to review proposed-output status and current conflicts. Inspection includes each output's `jobStatus`; files from unfinished jobs are `blocked`. A file marked `ready` is only a file-level result: another job failure or conflict can still block integration of the entire run.

There is no persistent inter-agent conversation. For a follow-up, copy a reviewed, sanitized summary into an ordinary project file, then explicitly include it as context in the next manifest. Paths inside `.swarm/` are reserved and cannot be used directly as manifest context.

If one output is unacceptable, do not integrate the run simply to obtain another output. Start a corrected run, or make a separately reviewed manual change. The standard integration command operates on the complete run; it does not offer selective job integration.

## Model selection

Set a job's `model` field when you want a specific model or alias. For Claude only, omitting it leaves model choice to the installed Claude CLI's default. Availability and alias resolution depend on the provider account and CLI.

Use recorded provider metadata to distinguish the requested alias from the model that answered. A label such as `sonnet` is not a guarantee of a permanent model version. Select models based on observed task quality, latency, and account access; this project does not assume a model is cheaper or better without evidence.

Timeout and concurrency settings bound simultaneous work and elapsed runtime. They are not a hard spending cap. A failed or cancelled provider request may still incur usage charges.

## Cancellation and recovery

```sh
node tools/swarm.mjs cancel <run-id>
```

The cancellation request tells the active runner to stop its own worker process groups and abort its own HTTP requests. It does not attach to or terminate unrelated agent sessions. You may also interrupt the attached runner.

A failed, timed-out, or cancelled run cannot be integrated through the normal command. Inspect its records, reduce or correct the assignment, and start a fresh run. Never translate a timeout into an assumption that the worker completed its files correctly.

## A useful completion report

Report these facts to the user:

- Requested and observed provider/model identities, when available.
- The concrete tasks delegated and outputs integrated.
- Findings accepted, rejected, or still uncertain.
- Tests or visual checks actually performed by the coordinator.
- Remaining limits, including any setup or checks that did not succeed.

Avoid claiming that the swarm deployed, tested, browsed, or communicated with other agents when those capabilities were not available to its workers.

For example, the website project's six-worker run produced a browser-test file and five focused reviews. The coordinator integrated the reviewed outputs, ran the browser checks, and made evidence-based accessibility and motion fixes. The accurate report distinguishes “the worker wrote tests” from “the coordinator executed them.” See the [case study](case-study.md) for the actual assignments and limits of the concurrency evidence.

## Included task recipes

The examples directory includes `code-review.json`, `ui-review.json`, `documentation.json`, `test-plan.json`, `four-reviewers.json`, and `mixed-provider-review.json`. They use this toolkit README as safe example context. Adapt the file lists, prompts, declared reports, and model names before using them on your application. After installation they are named `coordination/swarm-<example-name>.json`.

Code review asks for defects with source evidence; UI review evaluates supplied source and cannot see rendered pixels; documentation writes a complete declared Markdown output; test planning proposes checks without pretending to execute them. Four-reviewer and mixed-provider recipes explicitly opt into concurrency 4. Jobs are peers with snapshots, not a dependency graph. Use separate runs after integration for dependent stages. See [provider setup](providers.md) to configure only the providers you choose.
