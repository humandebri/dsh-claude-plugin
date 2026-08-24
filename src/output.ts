import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock, FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CLAUDE_ERROR_CODES, claudeError, protocolError } from './errors.js'
import { UsageTracker } from './usage.js'

interface OpenBlock {
  readonly type: 'text' | 'reasoning'
  text: string
}

function resultFailure(error: SDKAssistantMessageError | undefined) {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'billing_error':
      return claudeError(
        CLAUDE_ERROR_CODES.authenticationFailed,
        'Claude Code authentication or account access failed; run `claude auth login` and retry',
      )
    case 'model_not_found':
      return claudeError(
        CLAUDE_ERROR_CODES.modelNotFound,
        'Claude Code rejected the selected model',
      )
    case 'rate_limit':
      return claudeError(CLAUDE_ERROR_CODES.rateLimited, 'Claude Code rate limit was reached')
    default:
      return claudeError(
        CLAUDE_ERROR_CODES.transportError,
        `Claude Code ended the turn with ${error ?? 'an unknown execution error'}`,
      )
  }
}

function sameBlocks(left: readonly ContentBlock[], right: readonly ContentBlock[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function finish(reason: FinishReason): StreamChunk {
  return { type: 'finish', reason }
}

/** One-turn state machine translating authoritative SDK partial events into DSH chunks. */
export class ClaudeOutputTranslator {
  readonly #open = new Map<number, OpenBlock>()
  readonly #closed: ContentBlock[] = []
  readonly #completed: ContentBlock[] = []
  #assistantError: SDKAssistantMessageError | undefined
  #messageStopReason: string | null | undefined
  #sessionId: string | undefined
  #complete = false
  #terminalReason: FinishReason | undefined

  constructor(readonly usage: UsageTracker) {}

  get complete(): boolean {
    return this.#complete
  }

  get outputBlocks(): readonly ContentBlock[] {
    return this.#closed
  }

  get terminalReason(): FinishReason | undefined {
    return this.#terminalReason
  }

  #observeSession(message: { session_id?: string }): void {
    if (message.session_id === undefined) return
    if (this.#sessionId === undefined) this.#sessionId = message.session_id
    else if (this.#sessionId !== message.session_id) {
      throw protocolError('Claude SDK changed session identity inside one live bridge')
    }
  }

  #partial(message: Extract<SDKMessage, { type: 'stream_event' }>): StreamChunk[] {
    if (message.parent_tool_use_id !== null) {
      throw protocolError('Claude emitted subagent output while native tools were disabled')
    }
    const event = message.event
    switch (event.type) {
      case 'message_start':
      case 'message_stop':
        return []
      case 'message_delta':
        this.#messageStopReason = event.delta.stop_reason
        return []
      case 'content_block_start': {
        if (!Number.isSafeInteger(event.index) || event.index < 0 || this.#open.has(event.index)) {
          throw protocolError(`invalid or duplicate Claude content block index ${event.index}`)
        }
        const content = event.content_block
        let block: OpenBlock
        if (content.type === 'text') block = { type: 'text', text: content.text }
        else if (content.type === 'thinking') {
          block = { type: 'reasoning', text: content.thinking }
        } else {
          throw protocolError(
            `Claude emitted unsupported ${JSON.stringify(content.type)} content while tools were disabled`,
          )
        }
        this.#open.set(event.index, block)
        const chunks: StreamChunk[] = [
          { type: 'block-start', index: event.index, blockType: block.type },
        ]
        if (block.text.length > 0) {
          chunks.push(
            block.type === 'text'
              ? { type: 'text-delta', index: event.index, text: block.text }
              : { type: 'reasoning-delta', index: event.index, text: block.text },
          )
        }
        return chunks
      }
      case 'content_block_delta': {
        const block = this.#open.get(event.index)
        if (block === undefined) {
          throw protocolError(`Claude delta referenced unopened content block ${event.index}`)
        }
        const delta = event.delta
        if (delta.type === 'signature_delta') return []
        if (delta.type === 'text_delta' && block.type === 'text') {
          block.text += delta.text
          return [{ type: 'text-delta', index: event.index, text: delta.text }]
        }
        if (delta.type === 'thinking_delta' && block.type === 'reasoning') {
          block.text += delta.thinking
          return [{ type: 'reasoning-delta', index: event.index, text: delta.thinking }]
        }
        throw protocolError(
          `Claude emitted ${JSON.stringify(delta.type)} for a ${block.type} content block`,
        )
      }
      case 'content_block_stop': {
        const block = this.#open.get(event.index)
        if (block === undefined) {
          throw protocolError(`Claude stopped unopened content block ${event.index}`)
        }
        this.#open.delete(event.index)
        const content: ContentBlock =
          block.type === 'text'
            ? { type: 'text', text: block.text }
            : { type: 'reasoning', text: block.text }
        this.#closed.push(content)
        return [{ type: 'block-end', index: event.index, block: content }]
      }
    }
  }

  #assistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    if (message.parent_tool_use_id !== null) {
      throw protocolError('Claude emitted a subagent assistant message while tools were disabled')
    }
    this.#assistantError ??= message.error
    for (const block of message.message.content) {
      if (block.type === 'text') this.#completed.push({ type: 'text', text: block.text })
      else if (block.type === 'thinking') {
        this.#completed.push({ type: 'reasoning', text: block.thinking })
      } else if (message.error === undefined) {
        throw protocolError(
          `Claude completed unsupported ${JSON.stringify(block.type)} content while tools were disabled`,
        )
      }
    }
  }

  #result(message: SDKResultMessage): StreamChunk[] {
    if (this.#open.size > 0) throw protocolError('Claude result arrived with open content blocks')
    const chunks: StreamChunk[] = [{ type: 'usage', usage: this.usage.delta(message.modelUsage) }]
    const maxTokens =
      this.#assistantError === 'max_output_tokens' || message.stop_reason === 'max_tokens'
    if (maxTokens) {
      this.#complete = true
      this.#terminalReason = { kind: 'max-tokens' }
      chunks.push(finish(this.#terminalReason))
      return chunks
    }
    if (message.subtype !== 'success' || message.is_error || this.#assistantError !== undefined) {
      const error = resultFailure(this.#assistantError)
      this.#complete = true
      this.#terminalReason = { kind: 'error', failure: error.failure }
      chunks.push(finish(this.#terminalReason))
      return chunks
    }
    if (this.#closed.length > 0 && this.#completed.length === 0) {
      throw protocolError('Claude omitted completed assistant reconciliation messages')
    }
    if (this.#completed.length > 0 && !sameBlocks(this.#closed, this.#completed)) {
      throw protocolError('Claude partial and completed assistant content did not reconcile')
    }
    const stopReason = message.stop_reason ?? this.#messageStopReason
    if (stopReason === 'tool_use') {
      throw protocolError('Claude requested a tool while the tool bridge was disabled')
    }
    if (
      stopReason !== null &&
      stopReason !== undefined &&
      stopReason !== 'end_turn' &&
      stopReason !== 'stop_sequence'
    ) {
      throw protocolError(`Claude returned unsupported stop reason ${JSON.stringify(stopReason)}`)
    }
    this.#complete = true
    this.#terminalReason = { kind: 'stop' }
    chunks.push(finish(this.#terminalReason))
    return chunks
  }

  accept(message: SDKMessage): StreamChunk[] {
    if (this.#complete) throw protocolError('Claude emitted output after the terminal result')
    this.#observeSession(message)
    if (message.type === 'stream_event') return this.#partial(message)
    if (message.type === 'assistant') {
      this.#assistant(message)
      return []
    }
    if (message.type === 'result') return this.#result(message)
    return []
  }
}
