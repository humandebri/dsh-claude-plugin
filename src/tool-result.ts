import type { ToolResultMessage } from '@deepseek-ai/dsh-llm'

/** Correlated DSH result payload consumed by the parked MCP handler. */
export type ToolResult = Pick<ToolResultMessage, 'toolCallId' | 'content' | 'isError'>
