import { describe, expect, it, vi } from 'vitest'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import {
  BridgeManager,
  ClaudeCodeAdapter,
  type ClaudeQuery,
  type ClaudeQueryFactory,
  type ClaudeQueryRequest,
  resolveConfig,
} from '../src/index.js'
import { AsyncQueue } from '../src/async-queue.js'

const sdkSession = '11111111-1111-4111-8111-111111111111'

function sdk(value: unknown): SDKMessage {
  return value as SDKMessage
}

function envelope(event: unknown): SDKMessage {
  return sdk({
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    uuid: crypto.randomUUID(),
    session_id: sdkSession,
  })
}

function textTurn(text: string, inputTokens: number, outputTokens: number): SDKMessage[] {
  return [
    envelope({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: null },
    }),
    ...[...text].map((character) =>
      envelope({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: character },
      }),
    ),
    envelope({ type: 'content_block_stop', index: 0 }),
    sdk({
      type: 'assistant',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        model: 'sonnet',
        content: [{ type: 'text', text, citations: null }],
      },
      parent_tool_use_id: null,
      uuid: crypto.randomUUID(),
      session_id: sdkSession,
    }),
    sdk({
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
      modelUsage: {
        sonnet: {
          inputTokens,
          outputTokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
      uuid: crypto.randomUUID(),
      session_id: sdkSession,
    }),
  ]
}

function user(id: string, text: string): Message {
  return {
    id: id as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function assistant(id: string, text: string, model = 'default'): Message {
  return {
    id: id as never,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'claude-code', model },
  }
}

function request(
  messages: Message[],
  sessionId: string,
  extra: Partial<GenerateOptions> = {},
): GenerateOptions {
  return {
    provider: 'claude-code',
    model: 'default',
    messages,
    sessionId: sessionId as never,
    system: 'DSH owns the harness.',
    ...extra,
  }
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const values: StreamChunk[] = []
  for await (const value of iterable) values.push(value)
  return values
}

class FakeQuery implements ClaudeQuery {
  readonly output = new AsyncQueue<SDKMessage>()
  readonly inputs: SDKUserMessage[] = []
  readonly models: string[] = []
  closed = false
  readonly consumed: Promise<void>

  constructor(
    prompt: AsyncIterable<SDKUserMessage>,
    readonly onTurn: (query: FakeQuery, turn: number) => Promise<void> | void,
  ) {
    this.consumed = this.#consume(prompt)
  }

  async #consume(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    let turn = 0
    try {
      for await (const input of prompt) {
        this.inputs.push(input)
        if (input.shouldQuery === true) await this.onTurn(this, turn++)
      }
    } catch {
      // Bridge invalidation deliberately fails the SDK input queue.
    }
  }

  emit(messages: readonly SDKMessage[]): void {
    for (const message of messages) this.output.push(message)
  }

  setModel(model: string): Promise<void> {
    this.models.push(model)
    return Promise.resolve()
  }

  interrupt(): Promise<void> {
    return Promise.resolve()
  }

  close(): void {
    this.closed = true
    this.output.close()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.output
  }
}

function harness(
  onTurn: (query: FakeQuery, turn: number, queryIndex: number) => Promise<void> | void,
  config = resolveConfig(),
) {
  const requests: ClaudeQueryRequest[] = []
  const queries: FakeQuery[] = []
  const queryFactory: ClaudeQueryFactory = (queryRequest) => {
    const queryIndex = requests.length
    requests.push(queryRequest)
    const query = new FakeQuery(queryRequest.prompt, (current, turn) =>
      onTurn(current, turn, queryIndex),
    )
    queries.push(query)
    return query
  }
  const resolveExecutable = vi.fn(() => Promise.resolve('/usr/local/bin/claude'))
  const subprocess = { resolveExecutable } as unknown as SubprocessRuntime
  const manager = new BridgeManager(subprocess, config, queryFactory)
  const adapter = new ClaudeCodeAdapter(config, manager)
  return { adapter, manager, queries, requests, resolveExecutable }
}

describe('per-session Claude bridge', () => {
  it('starts an isolated SDK query and streams one complete text turn', async () => {
    const fixture = harness((query) => query.emit(textTurn('hello', 7, 5)))
    const chunks = await collect(fixture.adapter.stream(request([user('u1', 'hi')], 'session-a')))
    expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toHaveLength(5)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.filter((chunk) => chunk.type === 'finish')).toHaveLength(1)
    expect(fixture.resolveExecutable).toHaveBeenCalledWith('claude', undefined, undefined)
    const sdkOptions = fixture.requests[0]?.options
    expect(sdkOptions).toMatchObject({
      allowedTools: [],
      cwd: process.cwd(),
      hooks: {},
      includePartialMessages: true,
      managedSettings: { disableAllHooks: true },
      mcpServers: {},
      model: 'sonnet',
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      permissionMode: 'dontAsk',
      persistSession: true,
      plugins: [],
      settings: { disableAllHooks: true },
      settingSources: [],
      skills: [],
      strictMcpConfig: true,
      systemPrompt: 'DSH owns the harness.',
      tools: [],
    })
    expect(sdkOptions?.spawnClaudeCodeProcess).toBeTypeOf('function')
    expect(fixture.queries[0]?.inputs).toHaveLength(1)
    await fixture.manager.dispose()
  })

  it('reuses context, changes model between turns, and subtracts cumulative usage', async () => {
    const fixture = harness((query, turn) => {
      query.emit(turn === 0 ? textTurn('one', 10, 3) : textTurn('two', 16, 8))
    })
    const u1 = user('u1', 'first')
    await collect(fixture.adapter.stream(request([u1], 'session-a')))
    const chunks = await collect(
      fixture.adapter.stream(
        request([u1, assistant('a1', 'one'), user('u2', 'second')], 'session-a', {
          model: 'opus',
        }),
      ),
    )
    expect(fixture.queries).toHaveLength(1)
    expect(fixture.queries[0]?.models).toEqual(['opus'])
    expect(chunks.find((chunk) => chunk.type === 'usage')).toEqual({
      type: 'usage',
      usage: {
        inputTokens: 6,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    })
    await fixture.manager.dispose()
  })

  it('isolates different DSH sessions into different SDK queries', async () => {
    const fixture = harness((query, _turn, queryIndex) =>
      query.emit(textTurn(`answer-${queryIndex}`, 1, 1)),
    )
    await Promise.all([
      collect(fixture.adapter.stream(request([user('a', 'a')], 'session-a'))),
      collect(fixture.adapter.stream(request([user('b', 'b')], 'session-b'))),
    ])
    expect(fixture.queries).toHaveLength(2)
    expect(fixture.resolveExecutable).toHaveBeenCalledTimes(2)
    await fixture.manager.dispose()
  })

  it('serializes concurrent turns for the same DSH session', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const fixture = harness(async (query, turn) => {
      if (turn === 0) await gate
      query.emit(turn === 0 ? textTurn('one', 1, 1) : textTurn('two', 2, 2))
    })
    const u1 = user('u1', 'first')
    const first = collect(fixture.adapter.stream(request([u1], 'session-a')))
    await vi.waitFor(() => expect(fixture.queries[0]?.inputs).toHaveLength(1))
    const second = collect(
      fixture.adapter.stream(
        request([u1, assistant('a1', 'one'), user('u2', 'second')], 'session-a'),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fixture.queries[0]?.inputs).toHaveLength(1)
    releaseFirst()
    await Promise.all([first, second])
    expect(fixture.queries[0]?.inputs).toHaveLength(2)
    await fixture.manager.dispose()
  })

  it('aborts before output and during output without leaving a reusable bridge', async () => {
    const before = harness(() => undefined)
    const beforeController = new AbortController()
    beforeController.abort('cancelled')
    expect(
      await collect(
        before.adapter.stream(
          request([user('u', 'go')], 'before', { signal: beforeController.signal }),
        ),
      ),
    ).toEqual([
      {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: expect.objectContaining({ code: 'CLAUDE_ABORTED' }),
        },
      },
    ])
    expect(before.queries).toHaveLength(0)

    const duringController = new AbortController()
    const during = harness((query) => {
      query.emit([
        envelope({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: null },
        }),
        envelope({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'partial' },
        }),
      ])
      queueMicrotask(() => duringController.abort('stop'))
    })
    const chunks = await collect(
      during.adapter.stream(
        request([user('u', 'go')], 'during', { signal: duringController.signal }),
      ),
    )
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'aborted', failure: { code: 'CLAUDE_ABORTED' } },
    })
    expect(during.queries[0]?.closed).toBe(true)
    await Promise.all([before.manager.dispose(), during.manager.dispose()])
  })

  it('removes the request abort listener after a successful result', async () => {
    const controller = new AbortController()
    const fixture = harness((query, turn) =>
      query.emit(turn === 0 ? textTurn('one', 1, 1) : textTurn('two', 2, 2)),
    )
    const u1 = user('u1', 'first')
    await collect(fixture.adapter.stream(request([u1], 'session-a', { signal: controller.signal })))
    controller.abort('late')
    expect(fixture.queries[0]?.closed).toBe(false)
    await collect(
      fixture.adapter.stream(
        request([u1, assistant('a1', 'one'), user('u2', 'second')], 'session-a'),
      ),
    )
    expect(fixture.queries).toHaveLength(1)
    await fixture.manager.dispose()
  })

  it('fails closed when the system prompt or mirrored history changes', async () => {
    const fixture = harness((query) => query.emit(textTurn('one', 1, 1)))
    const u1 = user('u1', 'first')
    await collect(fixture.adapter.stream(request([u1], 'session-a')))
    const changed = await collect(
      fixture.adapter.stream(
        request([u1, assistant('a1', 'one'), user('u2', 'second')], 'session-a', {
          system: 'changed',
        }),
      ),
    )
    expect(changed.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'CLAUDE_PROTOCOL_ERROR' } },
    })
    expect(fixture.queries[0]?.closed).toBe(true)
    await fixture.manager.dispose()
  })
})
