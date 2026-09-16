# Changelog

## 1.0.0

First standalone package extracted from the Forge website project's local orchestration tools.

- Fresh Claude Code workers with explicit model selection and concurrency from one to three.
- Explicit input/output manifests, copied workspaces, bounded runtime and logs, and local run records.
- Saved responses with provider metadata when available, status inspection, and cancellation of owned workers.
- Conflict-checked integration of declared outputs, with file-mode preservation and no deletion propagation.
- Local prerequisite diagnostics, manifest validation, and proposed-change inspection.
- An explicit target-project root option and an installer that refuses destination overwrites.
- A reusable orchestration skill, smoke and parallel-review examples, deterministic tests, and setup and extension guides.
- A factual Forge case study distinguishing direct CLI implementation from reusable-runner smoke and review jobs.
- Apache License 2.0.

The supported adapter is Claude Code only. Copied workspaces are not an OS security sandbox; Windows support is not claimed.
