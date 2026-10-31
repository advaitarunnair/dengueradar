/** Client for the Copilot API (/api/*). Sends an anonymous session id used only for rate limiting. */

const SESSION_KEY = 'dengueradar-session'

/** Used when storage is blocked: a sandbox for this tab, never one shared with other visitors. */
const tabSession = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-').slice(0, 40)
let fallback: string | null = null

export function sessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    fallback ??= tabSession()
    return fallback
  }
}

const headers = () => ({ 'content-type': 'application/json', 'x-session-id': sessionId() })

async function parse<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Request failed (HTTP ${r.status})`)
  return body as T
}

export const apiGet = <T,>(path: string) => fetch(`/api/${path}`, { headers: headers() }).then((r) => parse<T>(r))
export const apiPost = <T,>(path: string, body: unknown) =>
  fetch(`/api/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }).then((r) => parse<T>(r))

/** POST and read a newline-delimited JSON stream of agent events. */
export async function apiStream(path: string, body: unknown, onEvent: (e: Record<string, unknown>) => void): Promise<void> {
  const r = await fetch(`/api/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  if (!r.ok || !r.body) {
    await parse(r)
    return
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
}
