import { describeTool } from '../../copilot'

export interface TraceStep { kind: 'status' | 'tool'; text: string }

/** What the agent did, step by step: live while it runs, and kept with every saved plan. */
export default function AgentTrace({ steps, running }: { steps: TraceStep[]; running: boolean }) {
  return (
    <ol className="space-y-1.5 text-sm" aria-live="polite">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={i} className="flex gap-2">
            <span aria-hidden className={`mt-0.5 w-4 shrink-0 text-center ${running && last ? 'animate-pulse text-accent' : 'text-ink-3'}`}>
              {running && last ? '●' : s.kind === 'tool' ? '↳' : '✓'}
            </span>
            <span className={s.kind === 'tool' ? 'text-ink-2' : 'text-ink'}>{s.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

export const stepsFromToolCalls = (calls: { name: string; args: string }[]): TraceStep[] =>
  calls.map((c) => ({ kind: 'tool', text: describeTool(c.name, c.args) }))
