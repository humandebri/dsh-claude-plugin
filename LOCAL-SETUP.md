# Local DSH integration

This branch targets DSH 0.1.7-rc.1 and adds Claude Opus 5.5, current DSH tool-message compatibility, and recovery from completed tool boundaries after restart. Incomplete tool calls still fail explicitly because their effects cannot safely be reconstructed. Full history replay has no plugin-specific byte cap; Claude context limits still apply.

Use this directory layout so the development dependencies in package.json resolve:

```text
DSH/
  core/
  runtime/
    bin/claude
    dsh-claude-plugin/
```

Build the sibling core checkout first, then run:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run test
```

The personal core checkout stores pinned versions, the executable wrapper, preset and restoration instructions in scripts/local-dsh. Authentication remains in the local Claude Code account; no credentials belong in this repository.

An optional live regression uses the authenticated Claude subscription and consumes usage:

```sh
node scripts/steering-live.mjs
node scripts/steering-live.mjs --large-history
```

The regression checks that new user instructions accompanying completed tool results are respected. The large-history variant includes a 285,009-byte tool result and does not modify project files.
