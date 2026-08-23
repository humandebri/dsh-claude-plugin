import type { ModelUsage } from '@anthropic-ai/claude-agent-sdk'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { CLAUDE_ERROR_CODES, claudeError } from './errors.js'

export interface UsageSnapshot {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

const ZERO_USAGE: UsageSnapshot = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

function counter(value: unknown, field: string): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw claudeError(
      CLAUDE_ERROR_CODES.usageEpochReset,
      `Claude usage field ${field} must be a non-negative safe integer`,
    )
  }
  return value
}

export function sumModelUsage(
  usage: Readonly<Record<string, Partial<ModelUsage>>> | undefined,
): UsageSnapshot {
  const total = { ...ZERO_USAGE }
  for (const [model, entry] of Object.entries(usage ?? {})) {
    total.inputTokens += counter(entry.inputTokens, `${model}.inputTokens`)
    total.outputTokens += counter(entry.outputTokens, `${model}.outputTokens`)
    total.cacheReadTokens += counter(entry.cacheReadInputTokens, `${model}.cacheReadInputTokens`)
    total.cacheWriteTokens += counter(
      entry.cacheCreationInputTokens,
      `${model}.cacheCreationInputTokens`,
    )
  }
  for (const [field, value] of Object.entries(total)) counter(value, field)
  return Object.freeze(total)
}

export class UsageTracker {
  #previous: UsageSnapshot = ZERO_USAGE

  get snapshot(): UsageSnapshot {
    return this.#previous
  }

  delta(usage: Readonly<Record<string, Partial<ModelUsage>>> | undefined): TokenUsage {
    const current = sumModelUsage(usage)
    const delta: TokenUsage = {
      inputTokens: current.inputTokens - this.#previous.inputTokens,
      outputTokens: current.outputTokens - this.#previous.outputTokens,
      cacheReadTokens: current.cacheReadTokens - this.#previous.cacheReadTokens,
      cacheWriteTokens: current.cacheWriteTokens - this.#previous.cacheWriteTokens,
    }
    if (Object.values(delta).some((value) => value !== undefined && value < 0)) {
      throw claudeError(
        CLAUDE_ERROR_CODES.usageEpochReset,
        'Claude cumulative usage moved backwards within one live query epoch',
      )
    }
    this.#previous = current
    return delta
  }

  resetEpoch(): void {
    this.#previous = ZERO_USAGE
  }
}
