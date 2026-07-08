---
name: "speckit-git-commit"
description: "Auto-commit changes after a Spec Kit command completes, per .specify/extensions/git/git-config.yml"
argument-hint: "Optional hook event name (e.g. after_specify); defaults to a manual invocation"
compatibility: "Requires spec-kit project structure with .specify/ directory and the git extension installed"
metadata:
  author: "github-spec-kit"
  source: "extensions/git/commands/speckit.git.commit.md"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

# Auto-Commit Changes

Automatically stage and commit all changes after a Spec Kit command completes. This skill is invoked either as a pre/post hook of another speckit command (in which case the hook event name, e.g. `after_specify` or `before_plan`, is passed as the argument) or directly by the user (in which case treat the event name as `manual`).

## Behavior

1. Determine the event name: use `$ARGUMENTS` if it looks like a hook event name (matches `^(before|after)_[a-z_]+$`), otherwise use `manual`.
2. Run the script below with that event name.
3. The script checks `.specify/extensions/git/git-config.yml` for the `auto_commit` section, looks up the specific event key (falling back to `auto_commit.default` if no event-specific key exists), and only commits if enabled is `true` for that key. **In this project both are `false`, so the script is a safe no-op unless the user has explicitly enabled auto-commit for an event.**
4. If enabled and there are uncommitted changes, it runs `git add .` + `git commit` with the configured (or a default) message.

## Execution

Run: `.specify/scripts/powershell/../../extensions/git/scripts/powershell/auto-commit.ps1 <event_name>` — i.e. from the repo root: `pwsh -NoProfile -File .specify/extensions/git/scripts/powershell/auto-commit.ps1 <event_name>`

(On a bash-only environment use `.specify/extensions/git/scripts/bash/auto-commit.sh <event_name>` instead.)

Replace `<event_name>` with the value determined above.

## Configuration

Edit `.specify/extensions/git/git-config.yml`, section `auto_commit`, to enable this for specific events:

```yaml
auto_commit:
  default: false          # Global toggle — set true to enable for all commands
  after_specify:
    enabled: true          # Override per-command
    message: "[Spec Kit] Add specification"
```

## Graceful Degradation

- If Git is not available or the current directory is not a repository: skips with a warning.
- If no config file exists: skips (disabled by default).
- If no changes to commit: skips with a message.

## Important

This project's global instructions say to only commit when the user explicitly asks. Even though the underlying script is config-gated (and currently disabled for every event), do not enable `auto_commit` in `git-config.yml` on the user's behalf — only run this skill directly when asked, or leave hook-triggered invocations to no-op as configured.
