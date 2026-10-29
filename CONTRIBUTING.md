# Working on this fork

This repository is Solar Punk's experimental fork of [snaha/swarm-id](https://github.com/snaha/swarm-id). It is
an experiment, so it takes no outside contributions, and its issues and discussions are switched off. To report a
problem in Swarm ID itself, or to contribute to it, go to [snaha/swarm-id](https://github.com/snaha/swarm-id).

What follows is how the fork is worked on.

## Code Style

We enforce consistent code style. Before committing:

```bash
pnpm check:all  # Format check, then each package's own check:all (lint, typecheck, unit tests, and knip in ui and demo)
```

### Style Rules

- **No semicolons**
- **Never use `null`**, use `undefined` instead
- **Never use `any`**, use proper types, generics, or `unknown`
- **kebab-case** for file and directory names
- **Format with Prettier**: `pnpm exec prettier --write <file>`

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type: short description

Optional longer description
```

### Types

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `refactor:` Code change that neither fixes a bug nor adds a feature
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

### Examples

```
feat: add WebAuthn passkey authentication
fix: resolve Safari storage access issue
docs: update architecture diagram
```

## Testing

- **Unit tests**: `*.test.ts` (Vitest), beside the code they cover
- **E2E and browser tests**: `tests/*.test.ts` in `ui/` (Playwright)
- **Integration tests**: `lib/test/integration/` (Vitest) against a local Bee cluster, run in CI
  by `integration-tests.yml`, and locally once `pnpm dev:cluster:start` is up
- **Live tests**: `lib/test/live/`, opt-in, they self-skip without a configured endpoint

Run tests with:

```bash
pnpm check:all                      # The unit-level checks, including each package's unit tests
pnpm --filter @solarpunkltd/swarm-id test  # One package's unit tests
```

There is no `pnpm test` at the repo root. Tests run per package, or through `check:all`.
CI also runs the integration, Playwright e2e, fork and three-device suites, each in its own
workflow.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
