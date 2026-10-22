/** Epi weeks, Sunday to Saturday (MMWR rule, as MOH uses). Mirrors scripts/common.py. */
export function epiWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const sunday = new Date(d); sunday.setUTCDate(d.getUTCDate() - d.getUTCDay())
  const wednesday = new Date(sunday); wednesday.setUTCDate(sunday.getUTCDate() + 3)
  const year = wednesday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1 = new Date(jan4); week1.setUTCDate(jan4.getUTCDate() - jan4.getUTCDay())
  const week = Math.round((sunday.getTime() - week1.getTime()) / (7 * 86400000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Today's date in Singapore as YYYY-MM-DD. */
export function sgToday(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}
