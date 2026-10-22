/** Liveness check: reports which server-side settings are present, never their values. */
export function GET(): Response {
  const has = (k: string) => Boolean(process.env[k])
  return Response.json({
    ok: true,
    env: { NEBIUS_API_KEY: has('NEBIUS_API_KEY'), TAVILY_API_KEY: has('TAVILY_API_KEY'), DATABASE_URL: has('DATABASE_URL') },
  })
}
