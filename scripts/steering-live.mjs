// Opt-in live regression: DSH tool result plus user steering in the same step.
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { BridgeManager, ClaudeCodeAdapter, resolveConfig } from '../lib/index.js'

const ctx = new Context()
const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
const config = resolveConfig({
  executablePolicy: 'host-only',
  claudeCommand: fileURLToPath(new URL('../../bin/claude', import.meta.url)),
  defaultModel: 'claude-opus-5-5',
})
const manager = new BridgeManager(ctx.subprocess, config)
const adapter = new ClaudeCodeAdapter(config, manager)
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 60000)
const messages = [
  {
    id: 'steering-user-1',
    role: 'user',
    source: { kind: 'user' },
    content: [
      {
        type: 'text',
        text: 'Call probe exactly once, then reply OLD_REPLY. Do not reply before using probe.',
      },
    ],
  },
]
const toolOutput = process.argv.includes('--large-history')
  ? 'PROBE_OK\n' + 'diagnostic-padding '.repeat(15000)
  : 'PROBE_OK'
const options = {
  provider: 'claude-code',
  model: 'claude-opus-5-5',
  sessionId: `steering-probe-${crypto.randomUUID()}`,
  messages,
  signal: controller.signal,
  system:
    'Follow the latest user instructions. This is a harmless transport regression test. Only probe is available.',
  tools: [
    {
      name: 'probe',
      description: 'Return a harmless diagnostic value.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}
async function step() {
  const assembler = new BlockAssembler()
  for await (const chunk of adapter.stream(options)) assembler.push(chunk)
  return assembler
}
try {
  const first = await step()
  const calls = first.blocks().filter((b) => b.type === 'tool-call')
  if (calls.length !== 1)
    throw new Error(`Expected one tool call, finish=${JSON.stringify(first.finish)}`)
  messages.push({
    id: 'steering-assistant-1',
    role: 'assistant',
    source: { kind: 'model', provider: options.provider, model: options.model },
    content: first.blocks(),
  })
  for (const call of calls)
    messages.push({
      id: 'steering-tool-1',
      role: 'tool',
      source: { kind: 'tool', callId: call.id },
      toolCallId: call.id,
      content: [{ type: 'text', text: toolOutput }],
    })
  messages.push({
    id: 'steering-user-2',
    role: 'user',
    source: { kind: 'user' },
    content: [
      {
        type: 'text',
        text: 'New instruction: reply exactly NEW_REPLY instead of OLD_REPLY. Do not call any more tools.',
      },
    ],
  })
  const second = await step()
  const text = second
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  console.log(
    JSON.stringify({
      finish: second.finish,
      reply: text,
      steeringApplied: text === 'NEW_REPLY',
      toolOutputBytes: Buffer.byteLength(toolOutput, 'utf8'),
    }),
  )
  if (text !== 'NEW_REPLY')
    throw new Error('Claude did not apply the steering in the tool continuation')
} finally {
  clearTimeout(timeout)
  await manager.dispose()
  await subprocessFiber.dispose()
}
