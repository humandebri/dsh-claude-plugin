import { describe, expect, it } from 'vitest'
import { sumModelUsage, UsageTracker } from '../src/usage.js'

describe('cumulative Claude usage', () => {
  it('sums every model and emits only per-turn deltas', () => {
    const tracker = new UsageTracker()
    expect(
      tracker.delta({
        sonnet: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 2,
        },
        haiku: {
          inputTokens: 5,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      }),
    ).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
    expect(
      tracker.delta({
        sonnet: {
          inputTokens: 12,
          outputTokens: 10,
          cacheReadInputTokens: 8,
          cacheCreationInputTokens: 2,
        },
        haiku: {
          inputTokens: 5,
          outputTokens: 2,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 1,
        },
      }),
    ).toEqual({
      inputTokens: 2,
      outputTokens: 7,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
    })
  })

  it('treats missing optional counters and an empty catalog as zero', () => {
    expect(sumModelUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(sumModelUsage({ sonnet: { inputTokens: 1, outputTokens: 2 } })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('rejects invalid counters and a backwards cumulative epoch', () => {
    expect(() => sumModelUsage({ sonnet: { inputTokens: -1 } })).toThrow(
      /non-negative safe integer/,
    )
    expect(() => sumModelUsage({ sonnet: { outputTokens: 1.5 } })).toThrow(
      /non-negative safe integer/,
    )
    const tracker = new UsageTracker()
    tracker.delta({ sonnet: { inputTokens: 9, outputTokens: 4 } })
    expect(() => tracker.delta({ sonnet: { inputTokens: 8, outputTokens: 4 } })).toThrow(
      /moved backwards/,
    )
  })

  it('accepts a lower snapshot only after an explicit query-epoch reset', () => {
    const tracker = new UsageTracker()
    tracker.delta({ sonnet: { inputTokens: 20, outputTokens: 10 } })
    tracker.resetEpoch()
    expect(tracker.delta({ sonnet: { inputTokens: 2, outputTokens: 1 } })).toMatchObject({
      inputTokens: 2,
      outputTokens: 1,
    })
  })
})
