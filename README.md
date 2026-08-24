# dsh-claude-plugin

A from-scratch DeepSeek Harness adapter for running Claude Code as the primary
LLM route while preserving DSH's agent loop, tools, permissions, sessions, and
WebUI.

The design and implementation are being developed in small, independently
tested pull requests. No source code is copied from another plugin or project.

Developed by [snowan](https://github.com/snowan) with Codex assistance.

## Status

The package registers the `claude-code` provider and runs Claude turns through
the pinned Claude Agent SDK and DSH's managed subprocess service. It streams
text, thinking, raw tool calls, per-turn usage, and one terminal result while
retaining one serialized SDK query per live DSH session.

DSH tools are exposed through one in-process MCP server. Claude's native tools,
ambient MCP servers, settings, hooks, plugins, and main-session skills remain
disabled. Each MCP handler pauses until DSH executes the visible tool call and
returns the exact correlated result; the same Claude query then resumes.

This is the tool-bridge milestone, not the completed plugin. Text tool results
are supported. Images, cold replay, idle eviction, doctor/install automation,
and WebUI E2E arrive in later pull requests. Unsupported content or history
fails closed with a stable diagnostic rather than silently bypassing DSH.

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

The current route supports Standard-style text and DSH tool turns. Treat it as
pre-release until the authenticated tool E2E and later lifecycle/WebUI gates in
the implementation plan pass.

## Tool authority and correlation

Only tool names under `mcp__dsh__*` are allowed inside Claude Code. Tool schemas
are copied into the MCP catalog as raw JSON Schema, including nested, union,
enum, and constrained forms. Catalog changes are allowed only between settled
generations.

The bridge requires Claude Code to attach its provider tool-use ID as
`claudecode/toolUseId`. Before DSH receives a tool boundary, the bridge matches
that ID with the streamed call ID, DSH tool name, canonical arguments, and
catalog generation. Missing, duplicate, stale, timed-out, or mismatched data
closes the session with `CLAUDE_TOOL_PROTOCOL_ERROR` or
`CLAUDE_TOOL_TIMEOUT`; it never guesses by name or call order. This metadata is
a pinned Claude Code compatibility seam and must be reverified during upgrades.

## Configuration

| Field                    | Default     | Meaning                                      |
| ------------------------ | ----------- | -------------------------------------------- |
| `claudeCommand`          | `claude`    | Bare host executable or absolute path        |
| `executablePolicy`       | `host-only` | Host/bundled executable selection            |
| `defaultModel`           | `sonnet`    | Target of the `default` model alias          |
| `sessionIdleMs`          | 15 minutes  | Reserved for the session-lifecycle milestone |
| `toolRoundTripTimeoutMs` | 30 minutes  | Maximum pause awaiting a DSH tool result     |
| `shutdownGraceMs`        | 5 seconds   | Managed process shutdown grace               |
| `passEnv`                | `[]`        | Explicit non-sensitive environment names     |
| `debug`                  | `false`     | Safe transport diagnostics                   |

The child receives SDK protocol facts, non-secret OS home/identity variables
needed for Claude Code to locate its own authenticated profile, and explicitly
approved `passEnv` names. Sensitive names and all `DSH_*` environment entries
are rejected. Claude native tools, filesystem settings, SDK hooks, plugins,
main-session skills, and ambient MCP servers are disabled; only the in-process
DSH MCP server is configured. DSH remains the execution authority. Claude Code
still enforces any enterprise-managed policy installed by an administrator.

## Design documents

- [Current-source research](docs/research.md)
- [Architecture proposal](docs/proposal.md)
- [Detailed implementation plan](docs/implementation-plan.md)
- [Authors and provenance](AUTHORS.md)

## License

[MIT](LICENSE)
