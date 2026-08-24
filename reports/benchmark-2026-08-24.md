# Direct Claude versus DSH Claude benchmark

Status: **authenticated parity screen complete; targeted latency follow-up complete; full latency matrix incomplete**

## Executive result

- 54 measured lane observations: 27 direct Claude Agent SDK and 27 through DSH
  plus this plugin.
- 54/54 successful, 54/54 expected-output digest matches, and 54/54 passed all
  cleanup, tool-correlation, policy, transcript-integrity, and redaction
  invariants.
- No P0 plugin weakness was detected. There were zero child-process leaks and
  every one of 101 emitted tool calls had one correlated result.
- The broad screen's three apparent latency candidates were repeated for five
  pairs. Their median DSH overheads were -4.44%, +0.95%, and +1.85%, rejecting
  all three P1 candidates against the +20% threshold.
- Nine scenarios still have only one paired latency sample. Their correctness
  and safety evidence is valid, but their timing values remain P2 exploratory
  evidence rather than release-grade performance claims.

## Environment and evidence

Run | Scope | Exact plugin commit | Sampling | Result
--- | --- | --- | --- | ---
Broad screen | All 12 scenarios | `6480da3cc0aa8d70ab713d978704d3dd8f06b27b` | 0 warm-ups, 1 pair | 24/24 lane observations passed
Targeted follow-up | Three latency candidates | `c298ce38374175cc6ffc59b5200bf0eb35f5f90f` | 0 warm-ups, 5 pairs | 30/30 lane observations passed

Both runs used Node v25.4.0 on darwin/arm64, DSH 0.1.1-rc.2, Claude Agent SDK
0.3.241, Claude Code 2.1.241, model `sonnet`, and effort `medium`. Both started
from clean exact checkouts. Lane order alternated by scenario and repetition.

- [Broad-screen sanitized observations](data/benchmark-6480da3cc0aa.jsonl)
- [Targeted sanitized observations](data/benchmark-c298ce383741-targeted.jsonl)

The JSONL contains only stable verdicts, counts, timing, usage, and SHA-256
digests. It excludes prompts, output text, tool arguments, tool results,
provider errors, credentials, environment values, and local paths.

## Method

Each pair runs the same synthetic fixture twice: directly through the Claude
Agent SDK and through DSH's LLM runtime plus this plugin. Both lanes use the
same model alias, effort, controlled system prompt, workspace contents, tool
schemas, host Claude executable, disabled native hooks/plugins/skills, and
host-only authentication gate. The graders verify observable output and world
state instead of trusting model claims.

The broad screen covers short and streaming text, Unicode, reasoning JSON,
repository analysis, sequential and parallel tools, three-turn restart,
denied/missing tools, cancellation, image input, and image tool results. The
follow-up repeats only candidates whose one-pair DSH duration exceeded the 20%
P1 threshold, conserving account usage while directly testing the suspected
weaknesses.

## Correctness and safety

Evidence | Direct | DSH plugin
--- | ---: | ---:
Successful observations | 27/27 | 27/27
Expected-output digest matches | 27/27 | 27/27
All five invariants passed | 27/27 | 27/27
Tool calls / correlated results | 50 / 50 | 51 / 51
Child processes leaked | 0 | 0
Observations with provider usage | 26/27 | 26/27

Cancellation intentionally terminates before a provider result, explaining the
single missing usage record in each lane. In the checked-in broad run, direct
and DSH cancellation triggered in 102 ms and 101 ms respectively, emitted no
post-cancel terminal marker, correlated one tool result per call, and cleaned
all children.

## Five-pair latency follow-up

Latency cells are median / p95 milliseconds. These are the three candidates
selected from the broad screen; all five pairs and all output digests agreed.

Scenario | Direct pass | DSH pass | Direct duration | DSH duration | Median DSH overhead
--- | ---: | ---: | ---: | ---: | ---:
`text.short` | 5/5 | 5/5 | 1984 / 2439 | 1896 / 2024 | -4.44%
`repository.dependency-flow` | 5/5 | 5/5 | 3890 / 4333 | 3927 / 4077 | +0.95%
`multi.parallel-mixed` | 5/5 | 5/5 | 3622 / 4041 | 3689 / 4087 | +1.85%

The apparent +33.11%, +34.09%, and +21.70% overheads in the first one-pair
screen did not persist under repeated sampling. This is why the runner refuses
to issue P1 latency findings with fewer than five pairs.

## One-pair broad screen

These scenarios passed correctness, digest, safety, and cleanup checks in both
lanes. Their latency values are screening signals only.

Scenario | Direct duration | DSH duration | One-pair delta | Digest agreement
--- | ---: | ---: | ---: | ---:
`content.image-input` | 2053 ms | 2085 ms | +1.56% | 100%
`content.image-tool-result` | 3205 ms | 3385 ms | +5.62% | 100%
`reliability.cancellation` | 4564 ms | 2857 ms | -37.40% | 100%
`safety.denied-and-missing` | 3250 ms | 3342 ms | +2.83% | 100%
`session.three-turn-restart` | 5350 ms | 5146 ms | -3.81% | 100%
`text.long-stream` | 2604 ms | 2861 ms | +9.87% | 100%
`text.reasoning-json` | 1786 ms | 1910 ms | +6.94% | 100%
`text.unicode` | 2006 ms | 1926 ms | -3.99% | 100%
`tools.read-search-shell-edit` | 5124 ms | 5252 ms | +2.50% | 100%

## Usage telemetry

Dataset | Lane | Observations | Input tokens | Output tokens | Estimated provider cost
--- | --- | ---: | ---: | ---: | ---:
Broad screen | Direct | 12 | 17,777 | 1,436 | $0.051943
Broad screen | DSH | 12 | 17,772 | 1,352 | $0.051895
Targeted follow-up | Direct | 15 | 24,190 | 2,613 | $0.067237
Targeted follow-up | DSH | 15 | 24,180 | 2,496 | $0.060762

The broad totals are effectively equal. The targeted DSH total is lower because
one direct repository observation used an additional model turn. These are
observed accounting totals, not a general cost-saving claim.

## Weakness assessment

- **P0:** none detected in the plugin across the measured matrix. No policy
  escape, tool mis-correlation, structural transcript divergence, protected
  content leak, child leak, or core plugin failure occurred.
- **P1:** none confirmed in the three scenarios selected by the broad screen.
  All stayed below +20% median latency overhead with five pairs, and DSH had no
  success-rate loss.
- **P2:** latency sampling remains incomplete for the nine one-pair scenarios
  above. Run the default full command after the account usage window permits to
  promote those timing values into claims.

The first live attempt also found a benchmark-infrastructure defect: expected
direct-lane cancellation could be finalized as a successful observation before
the correctness grader passed, and task correctness was incorrectly reused as
the transcript-integrity invariant. The runner now force-closes the direct SDK
query like the plugin bridge, records actual cancellation-trigger latency,
requires both a clean terminal path and passing grader, and treats transcript
integrity as structural block evidence. The post-fix focused pair and broad run
both pass; this was not a plugin P0.

## Reproduce

```bash
npm run benchmark
npm run benchmark:live -- --quick
npm run benchmark:live -- --warmups 0 --repetitions 5 \
  --scenario text.short \
  --scenario repository.dependency-flow \
  --scenario multi.parallel-mixed
```

For the full release-grade latency matrix, use `npm run benchmark:live` from a
clean checkout. That runs one warm-up and five measured pairs for every
scenario and intentionally incurs substantially more Claude usage.

## Thresholds

- P0: policy escape, tool duplication/mis-correlation, structural transcript
  corruption, protected-content leak, child-process leak, or consistent core
  plugin failure while the paired direct baseline succeeds.
- P1: more than 20% median DSH latency overhead with at least five pairs, or
  more than five percentage points of success-rate loss.
- P2: incomplete pairing, fewer than five latency pairs, missing telemetry,
  documentation, or rare compatibility weakness.

## Primary references

- [Anthropic: stream responses in real time](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Anthropic: track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [Anthropic: work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [DeepSeek Harness benchmark entry point](https://github.com/deepseek-ai/deepseek-harness/blob/master/BENCHMARK.md)
- [DeepSeek Harness testing policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)
