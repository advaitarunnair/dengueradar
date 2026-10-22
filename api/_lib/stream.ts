/** Newline-delimited JSON stream, so the UI can show the agent's steps while it works. */
export function ndjson(run: (send: (event: unknown) => void) => Promise<void>): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'))
      try {
        await run(send)
      } catch (e) {
        const err = e as Error & { status?: number }
        if (!err.status) console.error(e)
        send({ type: 'error', error: err.status ? err.message : 'The agent hit a problem. Please try again.' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}
