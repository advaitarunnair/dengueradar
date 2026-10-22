/** Confirms the configured Nemotron model IDs exist on Token Factory and answer a tiny prompt. */
import 'dotenv/config'
import { MODELS, nebius, stripThinking, thinkingParams } from '../api/_lib/llm.ts'

const available = new Set<string>()
for await (const m of nebius().models.list()) available.add(m.id)
console.log(`Token Factory lists ${available.size} models.`)
for (const [key, id] of Object.entries(MODELS)) {
  const listed = available.has(id)
  const similar = [...available].filter((a) => a.toLowerCase().includes('nemotron')).sort()
  if (!listed) {
    console.log(`${key.padEnd(5)} ${id}: NOT LISTED. Nemotron models available:\n  ${similar.join('\n  ')}`)
    continue
  }
  const t0 = Date.now()
  try {
    const r = await nebius().chat.completions.create({
      model: id, max_tokens: 40, temperature: 0,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      ...thinkingParams(false),
    })
    const text = stripThinking(r.choices[0]?.message?.content)
    console.log(`${key.padEnd(5)} ${id}: listed, replied "${text.slice(0, 30)}" in ${Date.now() - t0} ms, ${r.usage?.total_tokens ?? '?'} tokens`)
  } catch (e) {
    console.log(`${key.padEnd(5)} ${id}: listed, but the test call failed: ${(e as Error).message}`)
  }
}
