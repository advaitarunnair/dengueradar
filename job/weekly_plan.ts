/**
 * Weekly plan step, run at the end of job/pipeline.sh (a Nebius Serverless AI job).
 * 1. Uses the data the pipeline just built, or downloads the latest published data from the live site.
 * 2. Slides the demo inspection window forward if the epi week changed.
 * 3. If this epi week has no canonical plan yet, runs the Nemotron Ultra planning agent once and saves it.
 * Env: NEBIUS_API_KEY, DATABASE_URL, TAVILY_API_KEY (optional), SITE_URL.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SITE = (process.env.SITE_URL ?? 'https://dengueradar.vercel.app').replace(/\/$/, '')
const DATA_DIR = join(process.cwd(), 'web', 'public', 'data')

async function main() {
  // The pipeline has just built fresh data locally; run on its own, the job fetches what is published.
  if (process.env.USE_LOCAL_DATA !== '1') {
    mkdirSync(DATA_DIR, { recursive: true })
    for (const f of ['meta.json', 'scores.geojson']) {
      const r = await fetch(`${SITE}/data/${f}?v=${Date.now()}`)
      if (!r.ok) throw new Error(`Could not download ${f}: HTTP ${r.status}`)
      writeFileSync(join(DATA_DIR, f), Buffer.from(await r.arrayBuffer()))
    }
  }
  // Imported after the data is in place: the data layer reads it on first use.
  const { ensureDemoData } = await import('../api/_lib/demo.ts')
  const { ensureCanonicalPlan } = await import('../api/_lib/plans.ts')
  await ensureDemoData()
  const r = await ensureCanonicalPlan()
  console.log(r.created ? `Drafted the canonical ${r.week} plan (id ${r.id}).` : `The canonical ${r.week} plan already exists or is being drafted; nothing to do.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
