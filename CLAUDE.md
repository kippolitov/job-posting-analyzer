<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/003-freemium-premium-tier/plan.md
<!-- SPECKIT END -->

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`kippolitov/job-posting-analyzer`), managed via the `gh` CLI. External PRs are not treated as a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet; created lazily). See `docs/agents/domain.md`.
