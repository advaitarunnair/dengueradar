import { useEffect, useRef, useState } from 'react'

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null
  start: () => void; stop: () => void
}
type Ctor = new () => SpeechRecognitionLike

const Recognition: Ctor | undefined = typeof window !== 'undefined'
  ? ((window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ??
     (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition)
  : undefined

/** Browser speech-to-text (Chrome, Edge, Safari). Appends final phrases to the notes. */
export default function Dictation({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<SpeechRecognitionLike | null>(null)
  useEffect(() => () => rec.current?.stop(), [])
  if (!Recognition) return <p className="text-xs text-ink-3">Voice input is not available in this browser; your phone keyboard’s dictation works too.</p>
  const toggle = () => {
    if (on) { rec.current?.stop(); return }
    const r = new Recognition()
    r.lang = 'en-SG'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim())
    }
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input stopped (${e.error}).`)
    r.onend = () => setOn(false)
    rec.current = r
    setError(null)
    r.start()
    setOn(true)
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={toggle} aria-pressed={on}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium ${on ? 'border-accent bg-accent text-white' : 'border-line text-accent'}`}>
        <span aria-hidden>{on ? '■' : '🎙'}</span> {on ? 'Stop dictation' : 'Dictate'}
      </button>
      {on && <span className="animate-pulse text-xs text-ink-2">Listening…</span>}
      {error && <span className="text-xs text-ink-2">⚠ {error}</span>}
    </span>
  )
}
