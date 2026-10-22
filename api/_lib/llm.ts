/**
 * Nebius Token Factory client (OpenAI-compatible) for NVIDIA Nemotron models.
 * Server-side only: the API key never reaches the browser.
 */
import OpenAI from 'openai'

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

let client: OpenAI | null = null
export function nebius(): OpenAI {
  if (!process.env.NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set')
  client ??= new OpenAI({ baseURL: BASE_URL, apiKey: process.env.NEBIUS_API_KEY, maxRetries: 2, timeout: 110_000 })
  return client
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
