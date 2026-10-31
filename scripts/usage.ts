/** Print daily token use: npm run usage */
import './env.ts'
import { dailyUsage } from '../api/_lib/usage.ts'

console.table(await dailyUsage())
