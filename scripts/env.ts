/** Load local secrets for scripts: .env (API keys) and .env.local (pulled from Vercel: DATABASE_URL). */
import { config } from 'dotenv'
config({ path: ['.env.local', '.env'], quiet: true })
