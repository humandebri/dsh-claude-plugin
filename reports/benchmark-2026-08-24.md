# Direct Claude versus DSH Claude benchmark

Status: incomplete; do not use for release or performance claims

## Environment

- Generated: 2026-08-24T09:43:15.117Z
- Plugin: 6480da3cc0aa8d70ab713d978704d3dd8f06b27b on michi/benchmarks; dirty=false
- Runtime: Node v25.4.0; darwin/arm64
- DSH 0.1.1-rc.2; Claude Agent SDK 0.3.241; Claude Code 2.1.241
- Route: model=sonnet; effort=medium
- Sampling: 0 warm-up(s), 1 measured repetition(s)
- Sanitized raw observations: `reports/data/benchmark-6480da3cc0aa.jsonl`

## Method

Each repetition runs the same synthetic fixture twice: directly through the Claude Agent SDK and through DSH's LLM runtime plus this plugin. The pair uses the same model alias, effort, system prompt, workspace contents, tool schemas, and host Claude executable. Lane order alternates by repetition. Warm-ups are excluded. Output text, prompts, tool arguments, tool results, paths, and provider errors are not written to artifacts; only stable verdicts, counts, timing, usage, and SHA-256 digests are retained.

Anthropic documents that partial-message streaming adds raw stream events alongside complete assistant and result messages, and that the latest result's `modelUsage` is the whole-query accounting source in streaming-input mode. DSH's testing policy requires real-provider tests for file writing, multi-turn, tool use, and cancellation, and requires verification of external state rather than trusting the model's own claim.

## Results

Latency cells are median / p95 milliseconds.

Scenario | Direct pass | DSH pass | Direct duration | DSH duration | DSH overhead | Output digest agreement
--- | ---: | ---: | ---: | ---: | ---: | ---:
content.image-input | 1/1 | 1/1 | 2053 / 2053 | 2085 / 2085 | 1.56% | 100%
content.image-tool-result | 1/1 | 1/1 | 3205 / 3205 | 3385 / 3385 | 5.62% | 100%
multi.parallel-mixed | 1/1 | 1/1 | 3756 / 3756 | 4571 / 4571 | 21.7% | 100%
reliability.cancellation | 1/1 | 1/1 | 4564 / 4564 | 2857 / 2857 | -37.4% | 100%
repository.dependency-flow | 1/1 | 1/1 | 3857 / 3857 | 5172 / 5172 | 34.09% | 100%
safety.denied-and-missing | 1/1 | 1/1 | 3250 / 3250 | 3342 / 3342 | 2.83% | 100%
session.three-turn-restart | 1/1 | 1/1 | 5350 / 5350 | 5146 / 5146 | -3.81% | 100%
text.long-stream | 1/1 | 1/1 | 2604 / 2604 | 2861 / 2861 | 9.87% | 100%
text.reasoning-json | 1/1 | 1/1 | 1786 / 1786 | 1910 / 1910 | 6.94% | 100%
text.short | 1/1 | 1/1 | 1945 / 1945 | 2589 / 2589 | 33.11% | 100%
text.unicode | 1/1 | 1/1 | 2006 / 2006 | 1926 / 1926 | -3.99% | 100%
tools.read-search-shell-edit | 1/1 | 1/1 | 5124 / 5124 | 5252 / 5252 | 2.5% | 100%

## Weaknesses

- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (content.image-input): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (content.image-tool-result): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (multi.parallel-mixed): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (reliability.cancellation): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (repository.dependency-flow): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (safety.denied-and-missing): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (session.three-turn-restart): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (text.long-stream): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (text.reasoning-json): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (text.short): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (text.unicode): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.
- **P2 P2_INSUFFICIENT_LATENCY_SAMPLES** (tools.read-search-shell-edit): the scenario has too few paired samples for a latency claim. Evidence: 1 of 5 required pairs.

## Thresholds

- P0: any policy escape, tool duplication/mis-correlation, transcript corruption, protected-content leak, child-process leak, or consistent core plugin failure when the paired direct baseline succeeds.
- P1: more than 20% median latency overhead with at least 5 pairs, or more than 5 percentage points of success-rate loss.
- P2: incomplete pairing, too few samples, missing telemetry, documentation, or rare compatibility weaknesses.

## Primary references

- [Anthropic: stream responses in real time](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Anthropic: track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [Anthropic: work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [DeepSeek Harness benchmark entry point](https://github.com/deepseek-ai/deepseek-harness/blob/master/BENCHMARK.md)
- [DeepSeek Harness testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)
