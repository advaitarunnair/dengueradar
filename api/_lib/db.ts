import { neon } from '@neondatabase/serverless'

let client: ReturnType<typeof neon> | null = null
/** Tagged-template SQL over Neon's HTTP driver (one round trip per query, fine for serverless). */
export function sql() {
  if (client) return client
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  client = neon(process.env.DATABASE_URL)
  return client
}

/** Tests run the real SQL against an in-process Postgres instead of Neon. */
export function useTestDb(testClient: unknown): void {
  client = testClient as ReturnType<typeof neon>
}
