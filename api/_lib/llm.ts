/**
 * Nebius Token Factory client (OpenAI-compatible) for NVIDIA Nemotron models.
 * Server-side only: the API key never reaches the browser.
 */
import OpenAI, { APIConnectionError, APIError } from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionMessage } from 'openai/resources/chat/completions'
import { checkBudget, LimitError, recordUsage } from './guard.ts'

export const MODELS = {
  /** Heavy reasoning: weekly plan and re-planning. */
  ULTRA: 'nvidia/Nemotron-3-Ultra-550b-a55b',
  /** Reports, summaries, chat, explanations. */
  SUPER: 'nvidia/nemotron-3-super-120b-a12b',
  /** Fast and cheap: checklists, repeat-offender flags. */
  NANO: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  /** Vision-language: photo classification. */
  VL: 'nvidia/Nemotron-3.5-Super-VL',
} as const
export type ModelKey = keyof typeof MODELS

export const BASE_URL = 'https://api.tokenfactory.nebius.com/v1/'

/**
 * Functions are killed at 120 s, so a stalled call must give up well before that and leave time for the labelled
 * fallback. Nano and Super normally answer in 3 to 15 s; Ultra plans are slower and keep the long timeout.
 */
export const REQUEST_LIMITS: Record<ModelKey, { timeout: number; maxRetries: number }> = {
  ULTRA: { timeout: 110_000, maxRetries: 2 },
  SUPER: { timeout: 45_000, maxRetries: 1 },
  NANO: { timeout: 40_000, maxRetries: 1 },
  VL: { timeout: 45_000, maxRetries: 1 },
}

/** The model stalled or is unavailable. A LimitError, so callers show the same labelled fallbacks. */
export class ModelBusyError extends LimitError {
  status = 503
  constructor() {
    super('The AI model didn’t respond in time. Please try again in a moment.')
  }
}

/** Temporary upstream trouble only. A rejected request or bad key (400, 401) is our bug and must stay visible. */
function isTemporary(e: unknown): boolean {
  if (e instanceof APIConnectionError) return true
  return e instanceof APIError && (e.status === 408 || e.status === 429 || (e.status ?? 0) >= 500)
}

let client: OpenAI | null = null
export function nebius(): OpenAI {
  if (client) return client
  if (!process.env.NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set')
  client = new OpenAI({ baseURL: BASE_URL, apiKey: process.env.NEBIUS_API_KEY })
  return client
}

/** For tests: a stand-in for the Nebius client, so no model is called. */
export function useTestClient(c: OpenAI | null): void {
  client = c
}

/** Remove model reasoning (<think>...</think>, including an unclosed block) before text reaches users. */
export function stripThinking(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim()
}

/**
 * Nemotron 3 models reason by default and return it in a separate `reasoning_content` field, which costs
 * tokens. Reasoning is switched off unless a caller needs it (only the Ultra planning calls do).
 * Reasoning text is never returned to users.
 */
export function thinkingParams(thinking: boolean) {
  return { chat_template_kwargs: { enable_thinking: thinking } }
}


export interface CompleteOptions {
  model: ModelKey
  endpoint: string
  session: string
  messages: ChatCompletionMessageParam[]
  maxTokens: number
  thinking?: boolean
  temperature?: number
  tools?: ChatCompletionTool[]
  json?: boolean
}

export interface Completion {
  message: ChatCompletionMessage
  /** Visible answer with any reasoning removed. */
  text: string
  usage: { prompt: number; completion: number }
  finishReason: string | null
}

/** One guarded Nemotron call: budget check first, usage logged after, reasoning stripped. */
export async function complete(o: CompleteOptions): Promise<Completion> {
  const model = MODELS[o.model]
  await checkBudget(o.session)
  let r: OpenAI.Chat.Completions.ChatCompletion
  try {
    r = await nebius().chat.completions.create({
      model,
      messages: o.messages,
      max_tokens: o.maxTokens,
      temperature: o.temperature ?? 0.3,
      ...(o.tools ? { tools: o.tools, tool_choice: 'auto' as const } : {}),
      ...(o.json ? { response_format: { type: 'json_object' as const } } : {}),
      ...thinkingParams(o.thinking ?? false),
    }, REQUEST_LIMITS[o.model])
  } catch (e) {
    if (isTemporary(e)) { console.error(e); throw new ModelBusyError() }
    throw e
  }
  const usage = { prompt: r.usage?.prompt_tokens ?? 0, completion: r.usage?.completion_tokens ?? 0 }
  await recordUsage(o.session, model, o.endpoint, usage.prompt, usage.completion)
  const message = r.choices[0].message
  return { message, text: stripThinking(message.content), usage, finishReason: r.choices[0].finish_reason }
}

/** Parse a JSON object from model text, tolerating code fences or a sentence around it. */
export function parseJson<T>(text: string): T {
  const fenced = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    return JSON.parse(fenced) as T
  } catch {
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(fenced.slice(start, end + 1)) as T
    throw new Error('Model did not return valid JSON')
  }
}
