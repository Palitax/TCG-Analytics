# Custom Rules for Cardmarket Price Tracker Pro

## Git Auto-Commit & Push Rule
- **Rule**: After completing any implementation phase, code modification, or bug fix, the agent MUST automatically perform the following steps:
  1. Add all changed files to git: `git add .` (respecting `.gitignore`).
  2. Commit the changes with a concise, descriptive commit message in English detailing what was changed.
  3. Push the commits to the current remote branch (e.g. `git push origin HEAD` or `git push` if a remote tracking branch is configured).
- **Execution**: The agent should run these commands using the terminal/shell tool directly without waiting for explicit confirmation, unless there is a conflict or an authentication issue.
