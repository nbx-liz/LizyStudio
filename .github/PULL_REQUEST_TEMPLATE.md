## Summary

<!-- 1-3 bullet points describing the change -->

-

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring (no behavior change)
- [ ] Documentation
- [ ] CI / Build
- [ ] Release (develop → main only)
- [ ] Other: <!-- describe -->

## Branch target

<!-- Required: confirm the base branch matches project workflow. -->
<!-- Feature / fix / refactor / docs / chore / ci PRs MUST target `develop`. -->
<!-- Only release PRs target `main`, and only when cut from `develop`. -->

- [ ] Base branch is `develop` (feature / fix / refactor / docs / chore / ci)
- [ ] Base branch is `main` **and** this PR is cut from `develop` as a release PR

## Related issues / proposals

<!-- Link issues (Fixes #123) or HISTORY.md proposals (H-XXXX) -->

## DoD (Definition of Done)

### Backend
- [ ] `uv run ruff check .` clean
- [ ] `uv run ruff format --check .` clean
- [ ] `uv run mypy src/lizystudio/` clean
- [ ] `uv run pytest` passing

### Frontend
- [ ] `pnpm check` clean (Biome lint + format)
- [ ] `pnpm test -- --run` passing
- [ ] `pnpm build` success

### Common
- [ ] API / Adapter Protocol / shared type changes have a HISTORY.md H-XXXX proposal
- [ ] Frontend dependency additions have a HISTORY.md H-XXXX proposal
- [ ] CHANGELOG.md updated (if user-facing change)

## Test plan

<!-- How was this verified? Include manual steps if UI changed. -->

-

## Checklist

- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] No secrets or credentials in the diff
- [ ] No direct commits to `main` or `develop`
