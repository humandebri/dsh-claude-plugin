import { cwd as processCwd } from 'node:process'
import {
  query as sdkQuery,
  type Options as ClaudeSdkOptions,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './index.js'
import { AsyncQueue } from './async-queue.js'
import { abortError, protocolError, transportError } from './errors.js'
import { LiveInputCursor } from './input.js'
import { ClaudeOutputTranslator } from './output.js'
import { ClaudeProcessFactory, resolveClaudeExecutable, sdkEnvironment } from './process.js'
import { UsageTracker } from './usage.js'

export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  setModel(model: string): Promise<void>
  interrupt(): Promise<unknown>
  close(): void
}

export interface ClaudeQueryRequest {
  readonly prompt: AsyncIterable<SDKUserMessage>
  readonly options: ClaudeSdkOptions
}

export type ClaudeQueryFactory = (request: ClaudeQueryRequest) => ClaudeQuery

export const defaultQueryFactory: ClaudeQueryFactory = (request) => sdkQuery(request) as Query

class AsyncMutex {
  #tail: Promise<void> = Promise.resolve()

  async acquire(): Promise<() => void> {
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const prior = this.#tail
    this.#tail = prior.then(() => current)
    await prior
    return release
  }
}

class SessionBridge {
  readonly #input = new AsyncQueue<SDKUserMessage>()
  readonly #output = new AsyncQueue<SDKMessage>()
  readonly #cursor = new LiveInputCursor()
  readonly #usage = new UsageTracker()
  readonly #mutex = new AsyncMutex()
  readonly #abortController = new AbortController()
  #query: ClaudeQuery | undefined
  #pump: Promise<void> | undefined
  #system: string | undefined
  #model: string | undefined
  #closed = false

  constructor(
    readonly subprocess: SubprocessRuntime,
    readonly processFactory: ClaudeProcessFactory,
    readonly config: ResolvedConfig,
    readonly queryFactory: ClaudeQueryFactory,
  ) {}

  get closed(): boolean {
    return this.#closed
  }

  async #start(model: string, system: string | undefined, signal?: AbortSignal): Promise<void> {
    const executable = await resolveClaudeExecutable(
      this.subprocess,
      this.config.claudeCommand,
      this.config.executablePolicy,
      signal,
    )
    const options: ClaudeSdkOptions = {
      abortController: this.#abortController,
      allowedTools: [],
      cwd: processCwd(),
      env: sdkEnvironment(this.config.passEnv),
      hooks: {},
      includePartialMessages: true,
      managedSettings: { disableAllHooks: true },
      mcpServers: {},
      model,
      permissionMode: 'dontAsk',
      persistSession: true,
      plugins: [],
      settings: { disableAllHooks: true },
      settingSources: [],
      skills: [],
      spawnClaudeCodeProcess: this.processFactory.spawn,
      strictMcpConfig: true,
      systemPrompt: system ?? '',
      tools: [],
      ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    }
    this.#query = this.queryFactory({ prompt: this.#input, options })
    this.#model = model
    this.#system = system
    this.#pump = this.#pumpOutput(this.#query)
  }

  async #pumpOutput(query: ClaudeQuery): Promise<void> {
    try {
      for await (const message of query) this.#output.push(message)
      this.#output.close()
    } catch (error: unknown) {
      this.#output.fail(error)
    }
  }

  #invalidate(error: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#output.fail(error)
    this.#input.fail(error)
    this.#abortController.abort(error)
    this.#query?.close()
  }

  async *stream(options: GenerateOptions, model: string): AsyncIterable<StreamChunk> {
    const release = await this.#mutex.acquire()
    let committed = false
    const onAbort = () => this.#invalidate(abortError(options.signal?.reason))
    try {
      if (this.#closed) throw transportError('Claude session bridge is closed')
      if (options.signal?.aborted === true) throw abortError(options.signal.reason)
      if (this.#query === undefined) await this.#start(model, options.system, options.signal)
      else {
        if (this.#system !== options.system) {
          throw protocolError('DSH system prompt changed inside a live Claude query')
        }
        if (this.#model !== model) {
          await this.#query.setModel(model)
          this.#model = model
        }
      }
      const messages = this.#cursor.prepare(options)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      for (const message of messages) this.#input.push(message)

      const translator = new ClaudeOutputTranslator(this.#usage)
      while (!translator.complete) {
        const next = await this.#output.next()
        if (next.done) throw protocolError('Claude SDK output ended before a result message')
        for (const chunk of translator.accept(next.value)) yield chunk
      }
      if (translator.terminalReason?.kind === 'error') {
        committed = true
        this.#invalidate(transportError('Claude turn ended with a terminal provider error'))
        return
      }
      const blocks = translator.outputBlocks
      this.#cursor.commit(options.messages, { model: options.model, content: blocks })
      committed = true
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      if (!committed && !this.#closed) {
        this.#invalidate(
          protocolError('Claude generation ended before its DSH prefix was committed'),
        )
      }
      release()
    }
  }

  async dispose(): Promise<void> {
    this.#invalidate(transportError('Claude session bridge was disposed'))
    try {
      await this.#pump
    } catch {
      // The output queue already carries the transport failure to the active request.
    }
  }
}

function bridgeKey(options: GenerateOptions): string | undefined {
  if (options.sessionId === undefined) return undefined
  return `${String(options.sessionId)}\u0000${options.purpose ?? 'conversation'}`
}

/** Owns independent live SDK queries keyed by DSH session and request purpose. */
export class BridgeManager {
  readonly #bridges = new Map<string, SessionBridge>()
  readonly processFactory: ClaudeProcessFactory
  #disposed = false

  constructor(
    readonly subprocess: SubprocessRuntime,
    readonly config: ResolvedConfig,
    readonly queryFactory: ClaudeQueryFactory = defaultQueryFactory,
  ) {
    this.processFactory = new ClaudeProcessFactory(subprocess, config)
  }

  async *stream(options: GenerateOptions, model: string): AsyncIterable<StreamChunk> {
    if (this.#disposed) throw transportError('Claude bridge manager is disposed')
    const key = bridgeKey(options)
    const ephemeral = key === undefined
    let bridge = key === undefined ? undefined : this.#bridges.get(key)
    if (bridge === undefined || bridge.closed) {
      bridge = new SessionBridge(
        this.subprocess,
        this.processFactory,
        this.config,
        this.queryFactory,
      )
      if (key !== undefined) this.#bridges.set(key, bridge)
    }
    try {
      yield* bridge.stream(options, model)
    } finally {
      if (ephemeral || bridge.closed) {
        if (key !== undefined && this.#bridges.get(key) === bridge) this.#bridges.delete(key)
        await bridge.dispose()
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const bridges = [...this.#bridges.values()]
    this.#bridges.clear()
    await Promise.all(bridges.map((bridge) => bridge.dispose()))
    await this.processFactory.dispose()
  }
}
