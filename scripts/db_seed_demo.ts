/** Load db/demo_seed.json into Neon, replacing previous demo rows. Real (non-demo) rows are never touched. */
import './env.ts'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const db = neon(process.env.DATABASE_URL!)
const seed = JSON.parse(readFileSync('db/demo_seed.json', 'utf8'))

await db.query(`delete from photos where premises_id in (select id from premises where is_demo) and inspection_id is null`)
await db.query(`delete from inspections where is_demo`)
await db.query(
  `insert into premises (code, name, premises_type, subzone_id, lat, lon, layout_notes, is_demo)
   select code, name, premises_type, subzone_id, lat, lon, layout_notes, is_demo
   from jsonb_to_recordset($1::jsonb) as x(code text, name text, premises_type text, subzone_id text, lat float8, lon float8, layout_notes text, is_demo bool)
   on conflict (code) do update set name = excluded.name, premises_type = excluded.premises_type, subzone_id = excluded.subzone_id,
     lat = excluded.lat, lon = excluded.lon, layout_notes = excluded.layout_notes`,
  [JSON.stringify(seed.premises)],
)
await db.query(
  `insert into inspections (premises_id, inspected_on, epi_week, team_name, inspector, breeding_found, habitats, actions_taken,
                            follow_up_needed, follow_up_due, follow_up_done, is_demo)
   select p.id, x.inspected_on, x.epi_week, x.team_name, x.inspector, x.breeding_found, x.habitats, x.actions_taken,
          x.follow_up_needed, x.follow_up_due, x.follow_up_done, true
   from jsonb_to_recordset($1::jsonb) as x(premises_code text, inspected_on date, epi_week text, team_name text, inspector text,
        breeding_found bool, habitats jsonb, actions_taken text, follow_up_needed bool, follow_up_due date, follow_up_done bool)
   join premises p on p.code = x.premises_code`,
  [JSON.stringify(seed.inspections)],
)
const [c] = await db.query(`select (select count(*) from premises where is_demo) as premises,
  (select count(*) from inspections where is_demo) as inspections,
  (select count(*) from inspections where is_demo and breeding_found) as breeding`)
console.log(`Demo data loaded: ${c.premises} premises, ${c.inspections} inspections (${c.breeding} with breeding).`)
