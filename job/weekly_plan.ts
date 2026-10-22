/**
 * Weekly plan job, built to run as a Nebius Serverless AI job (container, CPU only).
 * 1. Downloads the latest published data from the live site (rankings, forecast, clusters).
 * 2. If this epi week has no plan yet (or FORCE=1), runs the Nemotron Ultra planning agent.
 * 3. Saves the draft to Neon with source = 'scheduled_job', so officers find it waiting on Monday.
 * Env: NEBIUS_API_KEY, DATABASE_URL, TAVILY_API_KEY (optional), SITE_URL, FORCE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SITE = (process.env.SITE_URL ?? 'https://dengueradar.vercel.app').replace(/\/$/, '')
const DATA_DIR = join(process.cwd(), 'web', 'public', 'data')

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })
  for (const f of ['meta.json', 'scores.geojson']) {
    const r = await fetch(`${SITE}/data/${f}?v=${Date.now()}`)
    if (!r.ok) throw new Error(`Could not download ${f}: HTTP ${r.status}`)
    writeFileSync(join(DATA_DIR, f), Buffer.from(await r.arrayBuffer()))
  }
  // Imported after the data is in place: the data layer reads it on first use.
  const { load } = await import('../api/_lib/data.ts')
  const { sql } = await import('../api/_lib/db.ts')
  const { DEFAULT_CONSTRAINTS, generatePlan, savePlan } = await import('../api/_lib/planner.ts')
  const week = load().meta.epi_week
  const existing = (await sql()`select count(*)::int as n from plans where epi_week = ${week}`) as { n: number }[]
  if (existing[0].n > 0 && process.env.FORCE !== '1') {
    console.log(`A plan for ${week} already exists (${existing[0].n} version(s)); nothing to do. Set FORCE=1 to draft a new version.`)
    return
  }
  console.log(`Drafting the ${week} plan with Nemotron Ultra…`)
  const plan = await generatePlan({
    session: 'nebius-serverless-job', constraints: DEFAULT_CONSTRAINTS,
    onEvent: (e) => console.log(e.type === 'tool' ? `  tool ${e.name} ${e.args}` : `  ${e.text}`),
  })
  const saved = await savePlan(plan, 'scheduled_job')
  console.log(`Saved ${week} plan version ${saved.version} (id ${saved.id}): ${plan.areas.length} areas, ` +
    `${plan.teams.map((t) => `${t.name} ${t.premises}/${t.capacity}`).join(', ')}; ${plan.checks.numbers_checked} numbers checked, ` +
    `${plan.agent.tokens} tokens.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
