<!-- project-swarm:start -->
## Project Swarm

Any agent may orchestrate this project. Read `{{SWARM_INSTALL}}/current/skills/project-swarm/SKILL.md`, then `{{SWARM_INSTALL}}/docs/kickoff.md` and `coordination/ORCHESTRATOR.md` before dispatching work.
Use `{{SWARM_INSTALL}}/current/tools/swarm.mjs` wherever the skill says `{{SWARM_RUNNER}}`; pass `--root` with this project's absolute path for project commands. Never pass `--root` to `update` or `version`.
Read and maintain `coordination/HANDOFF.md` and `coordination/TASK.md` after every dispatch. Ask which providers may receive project code and the spend ceiling before model calls. Never include secrets in worker context or commit `.swarm/`.
<!-- project-swarm:end -->
