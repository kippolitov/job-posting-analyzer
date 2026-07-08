---
name: "speckit-agent-context-update"
description: "Refresh the managed Spec Kit section inside CLAUDE.md so it points at the most recent plan.md"
argument-hint: "Optional plan_path; auto-detected from the most recently modified specs/*/plan.md when omitted"
compatibility: "Requires spec-kit project structure with .specify/ directory and the agent-context extension installed"
metadata:
  author: "github-spec-kit"
  source: "extensions/agent-context/commands/speckit.agent-context.update.md"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If it names a specific plan path, pass it through.

# Update Coding Agent Context

Refresh the managed Spec Kit section inside the active coding agent's context/instruction file (e.g. `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`).

## Behavior

The script reads the agent-context extension config at
`.specify/extensions/agent-context/agent-context-config.yml` to discover:

- `context_file` — the path of the coding agent context file to manage (in this project: `CLAUDE.md`).
- `context_markers.start` / `.end` — the delimiters surrounding the managed section (`<!-- SPECKIT START -->` / `<!-- SPECKIT END -->`).

It then creates, replaces, or appends the managed block so that the section points at the most recent plan path when one can be discovered (`specs/<feature>/plan.md`). Only the content strictly between those two markers is ever touched — the rest of `CLAUDE.md` is left untouched.

If `context_file` is empty or the file cannot be located, the command reports nothing to do and exits successfully.

## Execution

Run: `pwsh -NoProfile -File .specify/extensions/agent-context/scripts/powershell/update-agent-context.ps1 [plan_path]`

(On a bash-only environment: `.specify/extensions/agent-context/scripts/bash/update-agent-context.sh [plan_path]`)

When `plan_path` is omitted, the script auto-detects the most recently modified `specs/*/plan.md`.
