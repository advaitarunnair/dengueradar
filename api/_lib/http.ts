import { LimitError } from './guard.ts'

export class BadRequest extends Error {
  status = 400
}

/** Wrap a handler: JSON errors with safe messages, 429 for limits, 400 for bad input. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req)
    } catch (e) {
      if (e instanceof LimitError || e instanceof BadRequest) return Response.json({ error: e.message }, { status: e.status })
      console.error(e)
      return Response.json({ error: 'Something went wrong on the server. Please try again.' }, { status: 500 })
    }
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new BadRequest('Expected a JSON body')
  }
}
