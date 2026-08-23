# dsh-claude-plugin

A from-scratch DeepSeek Harness adapter for running Claude Code as the primary
LLM route while preserving DSH's agent loop, tools, permissions, sessions, and
WebUI.

The design and implementation are being developed in small, independently
tested pull requests. No source code is copied from another plugin or project.

Developed by [snowan](https://github.com/snowan) with Codex assistance.

## Status

The package registers the `claude-code` provider and runs text-only Claude turns
through the pinned Claude Agent SDK and DSH's managed subprocess service. It
streams text, thinking, per-turn usage, and one terminal result while retaining
one serialized SDK query per live DSH session.

This is the transport milestone, not the completed plugin. DSH tools, images,
cold replay, idle eviction, doctor/install automation, and WebUI E2E arrive in
later pull requests. A request containing tools or unsupported history fails
closed with a stable diagnostic rather than silently bypassing DSH.

## Requirements

- Node.js `22.19+` or `24+`
- DeepSeek Harness `0.1.1-rc.2`
- Claude Code CLI authenticated with a successful live generation
- `pnpm` on `PATH` for `dsh plugin` profile management

Claude Code authentication is not needed for deterministic CI. An authenticated
smoke requires a successful live generation; `claude auth status` alone is not
treated as proof of readiness, and the plugin never reads credential files.

## Build and verify

```bash
npm install
npm run check
```

After `claude auth login`, run the production adapter smoke against the host CLI:

```bash
npm run smoke:claude
```

Use `npm run smoke:claude -- --bundled` to exercise the SDK-bundled CLI instead.

## Install into a DSH profile

From this checkout:

```bash
dsh plugin --profile web add .
dsh --profile web --dump-config
```

Restart the profile after installing. The bundle adds one `llm-claude-code` row
and selects `claude-code/default` through the existing `agent-default-model`
row. Later user/profile patches retain precedence. To remove it:

```bash
dsh plugin --profile web remove dsh-claude-plugin
```

The current text-only route is suitable for transport testing. Standard DSH
coding sessions expose tools, so seamless Standard/WebUI use remains gated on
the next tool-bridge milestone.

## Configuration

| Field                    | Default     | Meaning                                      |
| ------------------------ | ----------- | -------------------------------------------- |
| `claudeCommand`          | `claude`    | Bare host executable or absolute path        |
| `executablePolicy`       | `host-only` | Host/bundled executable selection            |
| `defaultModel`           | `sonnet`    | Target of the `default` model alias          |
| `sessionIdleMs`          | 15 minutes  | Reserved for the session-lifecycle milestone |
| `toolRoundTripTimeoutMs` | 30 minutes  | Future DSH tool pause bound                  |
| `shutdownGraceMs`        | 5 seconds   | Managed process shutdown grace               |
| `passEnv`                | `[]`        | Explicit non-sensitive environment names     |
| `debug`                  | `false`     | Safe transport diagnostics                   |

The child receives SDK protocol facts, non-secret OS home/identity variables
needed for Claude Code to locate its own authenticated profile, and explicitly
approved `passEnv` names. Sensitive names and all `DSH_*` environment entries
are rejected. Claude native tools, filesystem settings, SDK hooks, plugins,
main-session skills, and ambient MCP servers are disabled; DSH remains the
intended execution authority. Claude Code still enforces any enterprise-managed
policy installed by an administrator.

## Design documents

- [Current-source research](docs/research.md)
- [Architecture proposal](docs/proposal.md)
- [Detailed implementation plan](docs/implementation-plan.md)
- [Authors and provenance](AUTHORS.md)

## License

[MIT](LICENSE)
