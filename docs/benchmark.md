# Benchmark and weakness evaluation

The benchmark compares the same Claude task through two local execution lanes:

```text
synthetic fixture ─┬─ direct ─> Claude Agent SDK ─> Claude Code
                   └─ dsh ────> DSH LLM runtime ─> plugin ─> same SDK/CLI
```

This measures adapter parity and overhead. It does not include WebUI/network
latency; the separate [WebUI end-to-end suite](web-e2e.md) proves the packed
plugin through DSH's public Web/RPC entry path and real Chromium.

The [current benchmark report](../reports/benchmark-2026-08-24.md) records the
latest verified result, including an explicit incomplete state when the
authenticated gate cannot run.

## Safety and evidence boundary

Live benchmarking is explicit because it consumes Claude usage. Before the
first measurement, the runner requires a clean Git checkout and runs the
host-only doctor with real generation. SDK startup, the isolated MCP catalog,
authentication, and child cleanup must all pass. A stale `claude auth status`
value is not accepted as proof.

The JSONL observations contain scenario IDs, stable verdicts, counts, timing,
token/cost estimates, process-cleanup evidence, and SHA-256 output digests.
They never contain prompts, response text, tool arguments, tool results,
provider errors, credentials, environment values, or local paths. The runner
checks that boundary before accepting each observation.

## Commands

List the versioned fixture matrix without invoking Claude:

```bash
npm run benchmark:list
```

Run only the authenticated gate:

```bash
npm run benchmark
```

After `claude auth login`, run the full paired suite:

```bash
npm run benchmark:live
```

The default is one excluded warm-up followed by five measured repetitions per
scenario. Lane order alternates by scenario and repetition. Use repeated
`--scenario` options to narrow a diagnosis:

```bash
npm run benchmark:live -- \
  --scenario text.short \
  --scenario tools.read-search-shell-edit
```

`--quick` runs one pair with no warm-up. It is useful for debugging the runner,
but the generated report stays incomplete and cannot support a latency claim.

## Controlled variables

Every pair holds these inputs constant:

- host Claude executable and Agent SDK version;
- model alias, reasoning effort, and system prompt;
- isolated workspace contents and image bytes;
- MCP/DSH tool names, descriptions, and JSON Schemas;
- tool implementation and externally verified world state;
- per-lane timeout and process-leak audit.

Claude native tools, ambient MCP servers, filesystem settings, hooks, plugins,
and skills are disabled in both lanes. The direct lane receives only the
benchmark MCP server. The DSH lane receives the same schemas through the
plugin's DSH-owned MCP pause/resume bridge.

## Scenario matrix

| Category    | Paired live scenario                                     | External assertion                       |
| ----------- | -------------------------------------------------------- | ---------------------------------------- |
| Text        | short exact answer, long stream, Unicode, reasoning JSON | deterministic output grader              |
| Repository  | inspect a four-file dependency chain                     | exact dependency flow                    |
| Tools       | read, search, allowlisted subprocess, edit               | edited and protected files re-read       |
| Multi-tool  | two reads plus one missing-path error                    | call IDs/results and final output        |
| Session     | two live turns, process restart, third turn              | exact remembered token after restart     |
| Safety      | denied destructive string and unavailable path           | protected file remains byte-identical    |
| Reliability | cancellation during a 30-second tool wait                | terminal marker absent and children gone |
| Content     | red PNG input and image tool result                      | exact visual-answer contracts            |

Deterministic companion tests cover failures that should not be induced against
the user's authenticated CLI: process crash (`process-keyless.spec.ts`),
malformed SDK events (`output.spec.ts`), tool timeout and stale correlation
(`pending-tools.spec.ts`), and abort races (`bridge.spec.ts`). The full
`npm run check` suite runs those fixtures before the live benchmark.

## Metrics and grading

Warm-ups are excluded. Each scenario reports direct and DSH success rate,
correctness rate, duration median/p95/range, first-token time, first-tool time,
cleanup time, output-digest agreement, stream block gaps/duplicates, tool
call/result counts, leaked children, token buckets, and estimated SDK cost when
available. The latest SDK result in each query epoch is used for cumulative
`modelUsage`; values are not summed across streaming-input results.

Graders are deterministic. The model's statement that it edited, read, denied,
or remembered something is never sufficient: the runner re-reads files, checks
tool IDs and settlement counts, and verifies the process tree.

## Severity and regression thresholds

- **P0:** policy escape, duplicate/mis-correlated tool execution, transcript
  corruption, protected-content leak, child leak, or consistent failure of a
  core DSH scenario while its paired direct baseline succeeds.
- **P1:** more than 20% median latency overhead with at least five pairs, or
  more than five percentage points of success-rate loss.
- **P2:** incomplete pairing, fewer than five samples, missing telemetry,
  documentation, or rare compatibility weakness.

Any P0 blocks release and receives its own fix PR plus a rerun of the failing
scenario. A missing login, dirty checkout, interrupted run, or insufficient
sample is reported as incomplete evidence—not converted into a plugin result.

## Primary references

- [Anthropic Agent SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Anthropic Agent SDK cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [Anthropic Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [DeepSeek Harness benchmark entry point](https://github.com/deepseek-ai/deepseek-harness/blob/master/BENCHMARK.md)
- [DeepSeek Harness testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)
