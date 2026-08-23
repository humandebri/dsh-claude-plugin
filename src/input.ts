import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { CLAUDE_ERROR_CODES, claudeError, unsupportedInput } from './errors.js'
import { PROVIDER_ID } from './models.js'

function contentEqual(left: readonly ContentBlock[], right: readonly ContentBlock[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function messageEqual(left: Message, right: Message): boolean {
  return (
    left.id === right.id &&
    left.role === right.role &&
    JSON.stringify(left.source) === JSON.stringify(right.source) &&
    contentEqual(left.content, right.content)
  )
}

function userMessage(message: Message): SDKUserMessage {
  if (message.role !== 'user') {
    throw unsupportedInput(`only user messages can be submitted to the live Claude input stream`)
  }
  const content = message.content.map((block) => {
    if (block.type !== 'text') {
      throw unsupportedInput(
        `message ${JSON.stringify(String(message.id))} contains unsupported ${JSON.stringify(block.type)} content`,
      )
    }
    return { type: 'text' as const, text: block.text }
  })
  if (content.length === 0) {
    throw unsupportedInput(`message ${JSON.stringify(String(message.id))} has no text content`)
  }
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  }
}

export interface CommittedAssistant {
  readonly model: string
  readonly content: readonly ContentBlock[]
}

/** Tracks the exact DSH prefix already represented by a live SDK query. */
export class LiveInputCursor {
  #prefix: readonly Message[] = []
  #assistant: CommittedAssistant | undefined

  prepare(options: GenerateOptions): SDKUserMessage[] {
    if ((options.tools?.length ?? 0) > 0) {
      throw unsupportedInput('DSH tools are not enabled until the tool-bridge milestone')
    }
    if (options.temperature !== undefined) {
      throw unsupportedInput('Claude Code does not expose DSH temperature control')
    }
    if (options.maxTokens !== undefined) {
      throw unsupportedInput('Claude Code does not expose DSH maxTokens control')
    }
    if ((options.stop?.length ?? 0) > 0) {
      throw unsupportedInput('Claude Code does not expose DSH stop sequences')
    }
    if (options.reasoningEffort !== undefined) {
      throw unsupportedInput('Claude reasoning effort selection is not enabled in this milestone')
    }

    let offset = 0
    if (this.#prefix.length > 0) {
      if (options.messages.length < this.#prefix.length) {
        throw claudeError(
          CLAUDE_ERROR_CODES.coldReplayUnsupported,
          'DSH history is shorter than the live Claude query prefix',
        )
      }
      for (const [index, prior] of this.#prefix.entries()) {
        const current = options.messages[index]
        if (current === undefined || !messageEqual(prior, current)) {
          throw claudeError(
            CLAUDE_ERROR_CODES.coldReplayUnsupported,
            `DSH history diverged from the live Claude query at message index ${index}`,
          )
        }
      }
      offset = this.#prefix.length
      const assistant = this.#assistant
      const mirrored = options.messages[offset]
      if (
        assistant === undefined ||
        mirrored?.role !== 'assistant' ||
        mirrored.source.kind !== 'model' ||
        mirrored.source.provider !== PROVIDER_ID ||
        mirrored.source.model !== assistant.model ||
        !contentEqual(mirrored.content, assistant.content)
      ) {
        throw claudeError(
          CLAUDE_ERROR_CODES.coldReplayUnsupported,
          'DSH history does not contain the exact assistant response held by the live Claude query',
        )
      }
      offset += 1
    } else if (options.messages.some((message) => message.role !== 'user')) {
      throw claudeError(
        CLAUDE_ERROR_CODES.coldReplayUnsupported,
        'a new Claude query cannot reconstruct pre-existing assistant or system history',
      )
    }

    const pending = options.messages.slice(offset)
    if (pending.length === 0) throw unsupportedInput('Claude generation requires new user content')
    const sdkMessages = pending.map(userMessage)
    for (const message of sdkMessages.slice(0, -1)) message.shouldQuery = false
    sdkMessages.at(-1)!.shouldQuery = true
    return sdkMessages
  }

  commit(messages: readonly Message[], assistant: CommittedAssistant): void {
    this.#prefix = [...messages]
    this.#assistant = {
      model: assistant.model,
      content: assistant.content.map((block) => Object.freeze({ ...block })) as ContentBlock[],
    }
  }
}
