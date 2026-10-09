export const num = (n: number) => n.toLocaleString('en-SG')

/** "2026-W40" -> "E-week 40, 2026" */
export function weekLabel(week: string): string {
  const [y, w] = week.split('-W')
  return `E-week ${Number(w)}, ${y}`
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/'(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
