import { describe, expect, it } from 'vitest'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { assertSdkUserInput, LiveInputCursor } from '../src/input.js'

function message(
  id: string,
  role: Message['role'],
  text: string,
  source: Message['source'] = { kind: 'user' },
): Message {
  return {
    id: id as never,
    role,
    content: [{ type: 'text', text }],
    source,
  }
}

function options(messages: Message[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'claude-code', model: 'default', messages, ...extra }
}

describe('live SDK input cursor', () => {
  it('submits multiple user frames with only the final frame triggering a query', () => {
    const cursor = new LiveInputCursor()
    const prepared = cursor.prepare(
      options([message('a', 'user', 'context'), message('b', 'user', 'go')]),
    )
    expect(prepared.map((entry) => entry.shouldQuery)).toEqual([false, true])
    expect(prepared[0]?.message).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'context' }],
    })
  })

  it('accepts an exact mirrored assistant response before the next user message', () => {
    const cursor = new LiveInputCursor()
    const first = [message('u1', 'user', 'first')]
    cursor.prepare(options(first))
    cursor.commit(first, {
      model: 'default',
      content: [{ type: 'text', text: 'answer' }],
    })
    const assistant = message('a1', 'assistant', 'answer', {
      kind: 'model',
      provider: 'claude-code',
      model: 'default',
    })
    expect(
      cursor.prepare(options([...first, assistant, message('u2', 'user', 'second')])),
    ).toHaveLength(1)
  })

  it('degrades cold history and fails closed on divergent live history', () => {
    const cold = new LiveInputCursor()
    const degraded = cold.prepareStep(
      options([
        message('old', 'assistant', 'old', {
          kind: 'model',
          provider: 'claude-code',
          model: 'default',
        }),
        message('new', 'user', 'new'),
      ]),
    )
    expect(degraded).toMatchObject({
      kind: 'prompt',
      start: { mode: 'degraded' },
      messages: [{ message: { role: 'user' }, shouldQuery: true }],
    })

    const cursor = new LiveInputCursor()
    const first = [message('u1', 'user', 'first')]
    cursor.prepare(options(first))
    cursor.commit(first, { model: 'default', content: [{ type: 'text', text: 'answer' }] })
    expect(() =>
      cursor.prepare(
        options([
          message('u1', 'user', 'changed'),
          message('a1', 'assistant', 'answer', {
            kind: 'model',
            provider: 'claude-code',
            model: 'default',
          }),
          message('u2', 'user', 'next'),
        ]),
      ),
    ).toThrow(/diverged/)
    expect(() =>
      cursor.prepare(
        options([
          ...first,
          message('a1', 'assistant', 'wrong', {
            kind: 'model',
            provider: 'claude-code',
            model: 'default',
          }),
          message('u2', 'user', 'next'),
        ]),
      ),
    ).toThrow(/exact assistant response/)
  })

  it('never reconstructs history with assistant-role SDK input', () => {
    const prepared = new LiveInputCursor().prepareStep(
      options([
        message('old', 'assistant', 'old answer', {
          kind: 'model',
          provider: 'claude-code',
          model: 'default',
        }),
        message('new', 'user', 'continue'),
      ]),
    )
    expect(prepared.kind).toBe('prompt')
    if (prepared.kind !== 'prompt') throw new Error('fixture expected a prompt plan')
    for (const input of prepared.messages) {
      expect(input).toMatchObject({ type: 'user', message: { role: 'user' } })
      expect(() => assertSdkUserInput(input)).not.toThrow()
    }
    expect(() =>
      assertSdkUserInput({
        type: 'assistant',
        message: { role: 'assistant', content: [] },
      } as never),
    ).toThrowError(expect.objectContaining({ code: 'CLAUDE_PROTOCOL_ERROR' }))
  })

  it.each([
    { temperature: 0 },
    { maxTokens: 100 },
    { stop: ['END'] },
    { reasoningEffort: 'high' as never },
  ])('rejects controls not owned by the Claude transport: %#', (extra) => {
    expect(() =>
      new LiveInputCursor().prepare(options([message('u', 'user', 'go')], extra)),
    ).toThrow(/not enabled|does not expose|not enabled/)
  })

  it('accepts exact DSH tool results as an MCP resume plan without a user prompt', () => {
    const cursor = new LiveInputCursor()
    const first = [message('u1', 'user', 'read the fixture')]
    expect(
      cursor.prepareStep(
        options(first, {
          tools: [
            {
              name: 'read',
              description: 'read a fixture',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }),
      ).kind,
    ).toBe('prompt')
    const toolCall = {
      type: 'tool-call' as const,
      id: 'toolu_read_1' as never,
      name: 'read',
      arguments: '{"path":"/fixture"}',
    }
    cursor.commit(first, { model: 'default', content: [toolCall] })
    const assistant: Message = {
      id: 'a1' as never,
      role: 'assistant',
      content: [toolCall],
      source: {
        kind: 'model',
        provider: 'claude-code',
        model: 'default',
      },
    }
    const toolResult: Message = {
      id: 'r1' as never,
      role: 'user',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'toolu_read_1' as never,
          content: [{ type: 'text', text: 'fixture-value' }],
          isError: false,
        },
      ],
      source: { kind: 'tool', callId: 'toolu_read_1' as never },
    }
    expect(cursor.prepareStep(options([...first, assistant, toolResult]))).toEqual({
      kind: 'tool-results',
      results: toolResult.content,
    })
    expect(() => cursor.prepare(options([...first, assistant, toolResult]))).toThrow(/resume/)
  })

  it('rejects malformed DSH tool-result continuation messages', () => {
    const cursor = new LiveInputCursor()
    const first = [message('u1', 'user', 'use a tool')]
    cursor.prepare(options(first))
    const call = {
      type: 'tool-call' as const,
      id: 'toolu_1' as never,
      name: 'read',
      arguments: '{}',
    }
    cursor.commit(first, { model: 'default', content: [call] })
    const assistant: Message = {
      id: 'a1' as never,
      role: 'assistant',
      content: [call],
      source: { kind: 'model', provider: 'claude-code', model: 'default' },
    }
    const valid: Message = {
      id: 'r1' as never,
      role: 'user',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'toolu_1' as never,
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
      source: { kind: 'tool', callId: 'toolu_1' as never },
    }
    for (const invalid of [
      { ...valid, role: 'assistant' as const },
      { ...valid, source: { kind: 'user' as const } },
      { ...valid, content: [] },
      { ...valid, source: { kind: 'tool' as const, callId: 'other' as never } },
      {
        ...valid,
        content: [
          {
            ...valid.content[0],
            content: [{ type: 'reasoning' as const, text: 'hidden' }],
          },
        ],
      },
    ]) {
      expect(() => cursor.prepareStep(options([...first, assistant, invalid as Message]))).toThrow(
        /tool boundary|correlation|content/,
      )
    }
  })

  it('rejects empty and non-text user content', () => {
    const base = message('u', 'user', 'go')
    expect(() => new LiveInputCursor().prepare(options([{ ...base, content: [] }]))).toThrow(
      /no text content/,
    )
    expect(() =>
      new LiveInputCursor().prepare(
        options([{ ...base, content: [{ type: 'reasoning', text: 'hidden' }] }]),
      ),
    ).toThrow(/unsupported/)
  })

  it('rejects a shortened live prefix, no new content, and an assistant in the pending suffix', () => {
    const cursor = new LiveInputCursor()
    const first = [message('u1', 'user', 'first'), message('u2', 'user', 'second')]
    cursor.prepare(options(first))
    cursor.commit(first, { model: 'default', content: [{ type: 'text', text: 'answer' }] })
    expect(() => cursor.prepare(options(first.slice(0, 1)))).toThrow(/history is shorter/)
    const mirrored = message('a1', 'assistant', 'answer', {
      kind: 'model',
      provider: 'claude-code',
      model: 'default',
    })
    expect(() => cursor.prepare(options([...first, mirrored]))).toThrow(/requires new user content/)
    expect(() => new LiveInputCursor().prepare(options([mirrored]))).toThrow(
      /requires new user content/,
    )
    expect(() =>
      cursor.prepare(
        options([
          ...first,
          mirrored,
          message('a2', 'assistant', 'unexpected', {
            kind: 'model',
            provider: 'claude-code',
            model: 'default',
          }),
        ]),
      ),
    ).toThrow(/only user messages/)
  })
})
