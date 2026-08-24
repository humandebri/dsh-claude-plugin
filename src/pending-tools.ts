import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { CallId, ContentBlock, ToolCallBlock, ToolResultBlock } from '@deepseek-ai/dsh-llm'
import { ClaudePluginError, toolProtocolError, toolTimeout } from './errors.js'

export const MCP_HANDLER_REGISTRATION_TIMEOUT_MS = 5_000

export interface PendingToolRegistration {
  readonly id: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly generation: number
  readonly signal?: AbortSignal
}

export interface PendingToolSnapshot {
  readonly id: string
  readonly name: string
  readonly arguments: string
  readonly generation: number
}

interface PendingEntry extends PendingToolSnapshot {
  readonly promise: Promise<CallToolResult>
  readonly resolve: (result: CallToolResult) => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
  readonly timer: ReturnType<typeof setTimeout>
}

function normalizedJson(value: unknown, path: string, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object') {
    throw toolProtocolError(`tool JSON at ${path} contains a non-JSON value`)
  }
  if (ancestors.has(value)) throw toolProtocolError(`tool JSON at ${path} contains a cycle`)
  ancestors.add(value)
  let output: unknown
  if (Array.isArray(value)) {
    output = value.map((entry, index) => normalizedJson(entry, `${path}[${index}]`, ancestors))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw toolProtocolError(`tool JSON at ${path} must contain only plain objects`)
    }
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value).sort()) {
      record[key] = normalizedJson(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        ancestors,
      )
    }
    output = record
  }
  ancestors.delete(value)
  return output
}

export function canonicalToolJson(value: unknown): string {
  return JSON.stringify(normalizedJson(value, '$'))
}

function parsedArguments(raw: string): Readonly<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    throw toolProtocolError('Claude emitted malformed JSON tool arguments', error)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw toolProtocolError('Claude tool arguments must be a JSON object')
  }
  return parsed as Readonly<Record<string, unknown>>
}

function mcpContent(content: readonly ContentBlock[]): CallToolResult['content'] {
  return content.map((block) => {
    if (block.type !== 'text') {
      throw toolProtocolError(
        `DSH tool result content type ${JSON.stringify(block.type)} is not enabled in this milestone`,
      )
    }
    return { type: 'text' as const, text: block.text }
  })
}

export function toMcpToolResult(result: ToolResultBlock): CallToolResult {
  return {
    content: mcpContent(result.content),
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  }
}

/** Correlates Claude MCP handlers with the exact DSH-visible tool calls and results. */
export class PendingTools {
  readonly #pending = new Map<string, PendingEntry>()
  readonly #seen = new Set<string>()
  readonly #waiters = new Set<() => void>()
  #failure: ClaudePluginError | undefined

  constructor(
    readonly timeoutMs: number,
    readonly onFailure: (error: ClaudePluginError) => void,
  ) {}

  get size(): number {
    return this.#pending.size
  }

  get snapshots(): readonly PendingToolSnapshot[] {
    return [...this.#pending.values()].map(({ id, name, arguments: args, generation }) => ({
      id,
      name,
      arguments: args,
      generation,
    }))
  }

  #notify(): void {
    for (const notify of this.#waiters) notify()
  }

  #cleanup(entry: PendingEntry): void {
    clearTimeout(entry.timer)
    if (entry.onAbort !== undefined) entry.signal?.removeEventListener('abort', entry.onAbort)
  }

  #fail(error: ClaudePluginError): ClaudePluginError {
    if (this.#failure !== undefined) return this.#failure
    this.#failure = error
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    for (const entry of entries) {
      this.#cleanup(entry)
      entry.reject(error)
    }
    this.#notify()
    this.onFailure(error)
    return error
  }

  fail(error: ClaudePluginError): ClaudePluginError {
    return this.#fail(error)
  }

  register(input: PendingToolRegistration): Promise<CallToolResult> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure)
    if (input.id.length === 0 || input.id.length > 512) {
      const error = this.#fail(toolProtocolError('Claude MCP tool-use ID is empty or too long'))
      return Promise.reject(error)
    }
    if (input.name.length === 0) {
      const error = this.#fail(toolProtocolError('Claude MCP tool name is empty'))
      return Promise.reject(error)
    }
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
      const error = this.#fail(toolProtocolError('Claude MCP tool catalog generation is invalid'))
      return Promise.reject(error)
    }
    if (this.#seen.has(input.id)) {
      const error = this.#fail(
        toolProtocolError(`Claude repeated tool-use ID ${JSON.stringify(input.id)}`),
      )
      return Promise.reject(error)
    }

    let argumentsJson: string
    try {
      argumentsJson = canonicalToolJson(input.arguments)
    } catch (error: unknown) {
      const failure =
        error instanceof ClaudePluginError
          ? error
          : toolProtocolError('Claude MCP tool arguments are not valid JSON', error)
      return Promise.reject(this.#fail(failure))
    }

    let resolve!: (result: CallToolResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<CallToolResult>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    const onAbort = () => {
      this.#fail(toolProtocolError(`Claude cancelled pending MCP tool ${JSON.stringify(input.id)}`))
    }
    const timer = setTimeout(() => {
      this.#fail(
        toolTimeout(`DSH tool result timed out for Claude tool-use ID ${JSON.stringify(input.id)}`),
      )
    }, this.timeoutMs)
    timer.unref?.()
    const entry: PendingEntry = {
      id: input.id,
      name: input.name,
      arguments: argumentsJson,
      generation: input.generation,
      promise,
      resolve,
      reject,
      signal: input.signal,
      onAbort,
      timer,
    }
    this.#seen.add(input.id)
    this.#pending.set(input.id, entry)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted === true) onAbort()
    this.#notify()
    return promise
  }

  async #waitForRegistration(expected: number, signal?: AbortSignal): Promise<void> {
    if (this.#pending.size >= expected || this.#failure !== undefined) return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.#waiters.delete(onChange)
        if (error === undefined) resolve()
        else reject(error)
      }
      const onChange = () => {
        if (this.#pending.size >= expected || this.#failure !== undefined) finish()
      }
      const onAbort = () => finish(toolProtocolError('DSH tool boundary wait was aborted'))
      const timer = setTimeout(
        () =>
          finish(
            toolProtocolError('Claude MCP handlers did not register before the tool boundary'),
          ),
        MCP_HANDLER_REGISTRATION_TIMEOUT_MS,
      )
      timer.unref?.()
      this.#waiters.add(onChange)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted === true) onAbort()
    })
  }

  async assertBoundary(
    calls: readonly ToolCallBlock[],
    generation: number,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.#waitForRegistration(calls.length, signal)
      if (this.#failure !== undefined) throw this.#failure
      const emitted = new Set<string>()
      for (const call of calls) {
        const id = String(call.id)
        if (emitted.has(id)) throw toolProtocolError(`DSH emitted duplicate tool-call ID ${id}`)
        emitted.add(id)
        const pending = this.#pending.get(id)
        if (pending === undefined) {
          throw toolProtocolError(`DSH tool boundary contains unknown Claude tool-use ID ${id}`)
        }
        if (pending.generation !== generation) {
          throw toolProtocolError(`DSH tool boundary contains a stale catalog generation for ${id}`)
        }
        if (pending.name !== call.name) {
          throw toolProtocolError(`Claude MCP and DSH tool names disagree for ${id}`)
        }
        if (pending.arguments !== canonicalToolJson(parsedArguments(call.arguments))) {
          throw toolProtocolError(`Claude MCP and DSH tool arguments disagree for ${id}`)
        }
      }
      if (emitted.size !== this.#pending.size) {
        throw toolProtocolError('Claude MCP registered tool calls absent from the DSH boundary')
      }
    } catch (error: unknown) {
      if (error instanceof ClaudePluginError) throw this.#fail(error)
      throw this.#fail(toolProtocolError('failed to correlate Claude MCP tool calls', error))
    }
  }

  resolveBatch(results: readonly ToolResultBlock[]): void {
    if (this.#failure !== undefined) throw this.#failure
    try {
      const resolved = new Set<string>()
      const completions: Array<{ entry: PendingEntry; result: CallToolResult }> = []
      for (const result of results) {
        const id = String(result.toolCallId)
        if (resolved.has(id)) throw toolProtocolError(`DSH repeated tool result ${id}`)
        resolved.add(id)
        const entry = this.#pending.get(id)
        if (entry === undefined) {
          throw toolProtocolError(
            this.#seen.has(id)
              ? `DSH supplied a stale or duplicate tool result ${id}`
              : `DSH supplied an unknown tool result ${id}`,
          )
        }
        completions.push({ entry, result: toMcpToolResult(result) })
      }
      if (resolved.size !== this.#pending.size) {
        throw toolProtocolError('DSH omitted one or more pending Claude tool results')
      }
      for (const { entry } of completions) {
        this.#pending.delete(entry.id)
        this.#cleanup(entry)
      }
      this.#notify()
      for (const completion of completions) completion.entry.resolve(completion.result)
    } catch (error: unknown) {
      if (error instanceof ClaudePluginError) throw this.#fail(error)
      throw this.#fail(toolProtocolError('failed to resolve DSH tool results', error))
    }
  }

  dispose(error = toolProtocolError('Claude pending tool registry was disposed')): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    for (const entry of entries) {
      this.#cleanup(entry)
      entry.reject(error)
    }
    this.#notify()
  }
}

export function asCallId(value: string): CallId {
  return value as CallId
}
