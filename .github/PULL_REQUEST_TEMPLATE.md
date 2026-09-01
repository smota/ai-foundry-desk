## Problem and outcome

<!-- What user or maintainer problem does this solve? What changes for them? -->

## Scope

<!-- Summarize the implementation and explicitly name important exclusions. -->

## Safety and compatibility

- [ ] Read-only and dry-run behavior remains read-only.
- [ ] Managed state, privilege, profile, service, credential, and network effects are described.
- [ ] Existing drift and user-owned content are preserved.
- [ ] Platform claims are limited to environments actually validated.

## Validation

<!-- List commands, test results, platforms, and any checks that were not run. -->

- [ ] `pnpm check`
- [ ] Mutating paths were previewed with `--dry-run` or `-WhatIf`.
- [ ] Relevant platform adapter or PowerShell parse checks passed.

## Documentation

- [ ] User-facing behavior and the CLI reference were updated, or no documentation change is needed.
- [ ] `CHANGELOG.md` was updated under `Unreleased`, or the change has no user-visible release impact.
- [ ] Local documentation links pass validation.

## Review notes

<!-- Call out security-sensitive decisions, migration effects, follow-up work, or reviewer focus areas. -->
