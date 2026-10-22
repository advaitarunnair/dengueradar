/**
 * Enforces "every number comes from our data": any number in model-written text must appear in
 * a tool result or in the officer's constraints (allowing for rounding). Unmatched numbers are flagged.
 */

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g

function values(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((t) => Number(t.replace(/,/g, ''))).filter((v) => Number.isFinite(v))
}

export class NumberLedger {
  private known = new Set<string>()

  add(source: unknown): void {
    for (const v of values(typeof source === 'string' ? source : JSON.stringify(source))) {
      for (const k of [0, 1, 2]) this.known.add(v.toFixed(k))
      this.known.add(String(v))
    }
  }

  private supported(v: number): boolean {
    return [0, 1, 2].some((k) => this.known.has(v.toFixed(k))) || this.known.has(String(v))
  }

  /** Numbers in the text that no tool result or constraint supports. */
  unsupported(text: string): number[] {
    // Ignore citation ids (S1), epi-week labels (W42) and ordinal list markers (1., 2.)
    const cleaned = text.replace(/\[?S\d+\]?/g, ' ').replace(/\bW\d{1,2}\b/gi, ' ').replace(/^\s*\d+\.\s/gm, ' ')
    return [...new Set(values(cleaned).filter((v) => !this.supported(v)))]
  }
}
