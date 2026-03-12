# AGENTS.md

## Project overview
This repository contains a Chrome Extension built with Manifest V3.
Preserve the extension architecture and avoid broad refactors unless explicitly requested.

## Product goals
- Keep the extension lightweight and stable.
- Minimize permissions and host permissions.
- Prefer simple, maintainable code over clever abstractions.
- Preserve user-visible behavior unless the task explicitly changes it.

## Architecture rules
- Do not change `manifest.json` structure unless required for the task.
- Do not upgrade or downgrade Manifest version unless explicitly requested.
- Keep responsibilities separated:
  - `background` / service worker: lifecycle, messaging, alarms, storage sync
  - `content scripts`: DOM access and page interaction
  - `popup` / options pages: UI only
- Do not move logic across these layers unless necessary.

## Security and privacy rules
- Request the smallest possible set of permissions.
- Never add remote code execution patterns.
- Never add inline scripts if avoidable.
- Never store secrets in the repository.
- Treat user data as sensitive and minimize collection/storage.

## Git rules
- Never commit binary files.
- Never commit `.zip`, `.crx`, `.pem`, `dist/`, `build/`, `node_modules/`, or secret files.
- Keep PRs small and task-focused.
- Prefer editing existing files over introducing many new files.

## Coding rules
- Prefer clear naming and small functions.
- Avoid unnecessary dependencies.
- Add comments only when the logic is not obvious.
- Keep logs minimal and remove temporary debug logs before finishing.

## Testing and validation
Before finishing:
1. Check for manifest consistency.
2. Verify imports and file paths.
3. Ensure permissions are still minimal.
4. Ensure background/content/popup messaging still matches.
5. If tests exist, run them.
6. If build scripts exist, run the build.
7. Summarize changed files and remaining risks.

## Output format
When completing a task:
- Summarize what changed.
- List any manifest or permission changes explicitly.
- Call out any manual browser verification steps.
- Keep the patch minimal.

## Forbidden actions
- Do not add tracking/analytics without explicit instruction.
- Do not introduce binary assets unless explicitly requested.
- Do not commit generated artifacts.
- Do not rename major folders unless explicitly requested.
