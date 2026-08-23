# Direct Claude versus DSH Claude benchmark

Status: **authenticated measurements blocked; no parity or performance claim**

## Current evidence

The paired runner, deterministic graders, sanitized JSONL schema, 12-scenario
fixture matrix, statistical analysis, and P0/P1/P2 gates are implemented on the
`michi/benchmarks` branch. The keyless implementation checks pass:

- 22 Vitest files and 187 tests;
- 95.24% statements, 91.71% branches, 97.39% functions, and 96.90% lines;
- formatting, lint, typecheck, build, package publication lint, package-content,
  documentation-link, and single-author-history checks;
- all 12 benchmark scenarios parse and list through the built runner.

The real host-only preflight was also exercised. It verified Node, package and
DSH peer compatibility, executable resolution, spawn lifecycle, SDK startup,
the DSH-only MCP handshake, and process cleanup. It then stopped with
`CLAUDE_AUTH_REQUIRED`: `auth.metadata` and `generation.live` failed. Host
Claude Code was 2.1.181; the pinned Agent SDK was 0.3.241 with bundled Claude
Code 2.1.241. The executable-version difference is a warning, not the auth
failure.

The local sanitized preflight artifact is
`.artifacts/benchmark-preflight.json` and is intentionally ignored by Git. A
deliberate `--live --quick --scenario text.short` attempt exited with the same
stable blocker before creating a measurement JSONL or Markdown result. No
numbers have been fabricated from this blocked run.

## Required authenticated rerun

Run:

```bash
claude auth login
npm run benchmark
npm run benchmark:live
```

The full command alternates direct and DSH lane order, excludes one warm-up,
and records five paired measurements per scenario. It will generate a sanitized
JSONL file under `reports/data/` and replace this report with environment,
median/p95/range, success, digest-agreement, usage, cleanup, and weakness data.

## Scenario matrix

| Category    | Scenario IDs                                                            |
| ----------- | ----------------------------------------------------------------------- |
| Text        | `text.short`, `text.long-stream`, `text.unicode`, `text.reasoning-json` |
| Repository  | `repository.dependency-flow`                                            |
| Tools       | `tools.read-search-shell-edit`                                          |
| Multi-tool  | `multi.parallel-mixed`                                                  |
| Session     | `session.three-turn-restart`                                            |
| Safety      | `safety.denied-and-missing`                                             |
| Reliability | `reliability.cancellation`                                              |
| Content     | `content.image-input`, `content.image-tool-result`                      |

## Weakness status

- **P0:** none established by authenticated comparison because no paired live
  observations exist yet.
- **P1:** latency and success-rate weakness cannot be evaluated without five
  authenticated pairs.
- **P2:** authenticated evidence is incomplete. This is the only reportable
  weakness from the current run and blocks release-readiness completion.

Deterministic tests already guard process crash, malformed events, timeout,
stale tool correlation, cancellation races, profile install/remove, and the
real keyless WebUI. Those tests demonstrate plumbing and failure handling, but
they are not substitutes for the missing real-model parity run.

## Thresholds

- P0: policy escape, tool duplication/mis-correlation, transcript corruption,
  protected-content leak, child leak, or consistent core plugin failure while
  the paired direct baseline succeeds.
- P1: more than 20% median DSH latency overhead with at least five pairs, or
  more than five percentage points of success-rate loss.
- P2: incomplete pairing, insufficient samples, missing telemetry,
  documentation, or rare compatibility weakness.

## Primary references

- [Anthropic: streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Anthropic: cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [Anthropic: sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [DeepSeek Harness benchmark entry point](https://github.com/deepseek-ai/deepseek-harness/blob/master/BENCHMARK.md)
- [DeepSeek Harness testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)
