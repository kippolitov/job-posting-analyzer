---
name: "speckit-git-initialize"
description: "Initialize a Git repository in the project directory with an initial commit, if one does not already exist"
compatibility: "Requires spec-kit project structure with .specify/ directory and the git extension installed"
metadata:
  author: "github-spec-kit"
  source: "extensions/git/commands/speckit.git.initialize.md"
user-invocable: true
disable-model-invocation: false
---

# Initialize Git Repository

Initialize a Git repository in the current project directory if one does not already exist.

## Execution

Run: `pwsh -NoProfile -File .specify/extensions/git/scripts/powershell/initialize-repo.ps1`

(On a bash-only environment: `.specify/extensions/git/scripts/bash/initialize-repo.sh`)

If the extension scripts are not found, fall back to:
`git init && git add . && git commit -m "Initial commit from Specify template"`

The script handles all checks internally:
- Skips if Git is not available
- Skips if already inside a Git repository
- Runs `git init`, `git add .`, and `git commit` with an initial commit message

## Output

On success: `[OK] Git repository initialized`

## Graceful Degradation

If Git is not installed:
- Warn the user
- Skip repository initialization
- The project continues to function without Git (specs can still be created under `specs/`)

If Git is installed but `git init`, `git add .`, or `git commit` fails:
- Surface the error to the user
- Stop this command rather than continuing with a partially initialized repository
