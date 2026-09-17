# Case study: Forge website redesign

Project Swarm originated during a pizza storefront redesign. The coordinator owned the visual direction, scroll story, renderer, integration, and final verification. Claude workers were used for bounded implementation and review tasks.

This account separates work done before the reusable runner existed from work performed through it. The package does not include the storefront's source, private provider transcripts, or local run directories.

## Before the reusable runner

A fresh Claude Code process first completed a scoped communication check. It was not a connection to an already-open terminal.

A later direct CLI assignment gave Claude ownership of the menu, builder controls, cart, location page, and commerce styles. The coordinator retained separate ownership of the hero, shared shell, rendering module, assets, build tooling, and verification. The observed build worker reported `claude-opus-5[1m]`.

That commerce implementation used a directly launched CLI process, not the reusable Project Swarm runner. It demonstrated a useful ownership split and informed the runner's design. A separate Codex tooling subagent helped implement the reusable runner and deterministic tests; that was also distinct from the runner's then-Claude-only adapter.

One concrete implementation correction was the cart quantity limit. The initial brief suggested 50, but Claude identified the server's actual cap as 20. The implementation and tests followed the server authority.

## First reusable-runner exchange

The runner launched two fresh Opus workers in separate copied workspaces. One reviewed the design brief; the other wrote a small preflight suggestion. The coordinator inspected both responses and integrated the declared written output.

This was a small connection and integration smoke exercise, not evidence that the runner had built the entire website. It demonstrated fresh process launch, concurrent independent assignments, saved responses, and a reviewed output import.

## Rendering and motion review

The next runner assignment used two explicit aliases: `sonnet` for a renderer review and `haiku` for a motion review. Provider events identified the responding models as `claude-sonnet-5` and `claude-haiku-4-5-20251001`. These identifiers describe that observed run; they are not promises about today's alias resolution or account availability.

The renderer review produced useful findings:

- **Framebuffer allocation:** the coordinator accepted a finding about avoidable backing-buffer reallocation and changed dimensions only when resizing was necessary.
- **Cheese fidelity:** feta became separate geometry; feta-only selections no longer rendered a mozzarella sheet. Cheddar and mixed cheese received distinct materials.
- **Ingredient distribution:** ordering, half-pizza density and boundaries, and instance-budget allocation were improved. A hypothetical case exceeding the real catalog's topping count was not treated as a demonstrated production defect.
- **Rendering cost:** possible per-pixel intersection expense was tested with actual GPU-synchronizing readback. The coordinator used render-on-demand behavior and an interaction resolution cap rather than accepting source-level speculation as a benchmark.

The motion review also made claims that inspection and browser tests did not support:

- A claimed reduced-motion ticker failure was contradicted by the global reduced-motion rule and a browser assertion.
- A claimed stale motion preference was contradicted by the live media-query checks and change listener; a runtime preference-switch test verified the behavior.
- A claimed active-chapter mismatch was contradicted by the same opacity weights governing both visual prominence and the exposed chapter.
- A mobile-height concern warranted testing. Short-phone chapter checks confirmed the relevant copy remained visible after an earlier sizing fix.
- A claimed persistent ember animation loop under reduced motion was contradicted by the early return before another frame was scheduled.

The coordinator retained the reports as local evidence and recorded accepted and rejected findings. A model's confidence was not a reason to accept a claim.

## What to reuse

The useful pattern was a narrow worker task followed by independent coordinator judgment:

1. Give each worker a concrete question and only the files needed to answer it.
2. Require source evidence and distinguish defects from hypotheses.
3. Keep output ownership separate when workers edit.
4. Reproduce findings, inspect proposed changes, and reject unsupported claims.
5. Integrate reviewed work and run actual application checks.

The overall website redesign included three visual refinement passes and application preflight work. Those were coordinator-led project activities; the swarm runner itself does not render websites, measure frame rates, run tests, or certify a finished design.

For a transferable version of the review pattern, adapt `examples/parallel-review.json` to your project's actual files.

## From connection checks to application work

For the 1.1 expansion, four fresh Claude acknowledgment workers ran concurrently and all completed. That established a bounded connection and concurrency check, not the quality of a larger coding assignment.

The runner then handled substantive website work. A topping-interface worker proposed changes to `commerce.js` and `commerce.css` in its copied workspace; the coordinator inspected and integrated those files. A subsequent four-worker ingredient geometry, rendering, and test-planning review completed. The coordinator checked the evidence and rejected unsupported claims instead of accepting every report.

Next, six fresh Claude workers ran simultaneously with `sonnet` requested in each assignment:

- `topping-browser-tests` wrote `tests/toppings.test.mjs`.
- `topping-accessibility` reviewed topping controls and announcements.
- `builder-price-integrity` reviewed selection and pricing behavior.
- `story-motion-review` reviewed scroll-story motion handling.
- `renderer-lifecycle` reviewed rendering resource behavior.
- `skill-user-workflow` reviewed the orchestration experience.

The coordinator observed all six in the running state together. All completed, and their declared reports and test file were inspected and integrated. The test-writing worker produced code; the coordinator ran the browser checks and performed visual inspection.

Actionable findings led to accessible price descriptions and topping-cap announcements, a reduced-motion inline-style reset, and clearer package inspection: `jobStatus` is exposed and an output from an unfinished job is marked `blocked`. Documentation was also clarified so a seemingly ready file is not mistaken for permission to integrate a run that has another conflict.

An independent package review found descendant-process cleanup and exact CLI prompt-logging issues. Both were fixed; the package's 48 tests passed at that review checkpoint. This is a historical result, not a substitute for running the current release's suite.

## What the scaling evidence establishes

Version 1.2 accepts up to 32 concurrent workers and 256 jobs per manifest, with concurrency defaulting to two. Six simultaneous real Claude workers were demonstrated; 32 simultaneous authenticated workers were not. A deterministic eight-worker queue test exercises scheduling with fake workers and must not be presented as eight live provider sessions.

The release has seven adapters: Claude, Hermes, Qwen, OpenAI, Gemini, Ollama, and Lambda. The Claude runs above do not establish another adapter's live availability. Hermes and Qwen authenticated inference were not verified in this work; Qwen CLI 0.24.0 help and doctor compatibility were checked only. The HTTP adapters have separate mock contract tests. Choose adapters according to their documented verification level and perform your own small authenticated smoke exchange before relying on them.

A second six-worker review ran through the 1.2 runtime while the coordinator refined ingredient geometry. Its monitor recorded `peakConcurrency: 6`, and all six jobs completed. Their findings prompted local-frame texture-normal correction, fallback icon corrections, and further worker-cleanup regressions. The final package suite reached 53 passing tests before publication.
