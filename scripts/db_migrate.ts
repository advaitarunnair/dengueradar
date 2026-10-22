/** Apply db/schema.sql to the database in DATABASE_URL. */
import './env.ts'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const db = neon(process.env.DATABASE_URL!)
const statements = readFileSync('db/schema.sql', 'utf8')
  .split(/;\s*$/m)
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter(Boolean)
for (const s of statements) await db.query(s)
const tables = await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)
console.log(`Applied ${statements.length} statements. Tables: ${tables.map((t) => t.table_name).join(', ')}`)
