import { useEffect, useState } from 'react'
import { Maximize, Minimize } from 'lucide-react'

export default function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [error, setError] = useState(false)
  useEffect(() => {
    const update = () => { setFullscreen(!!document.fullscreenElement); setError(false) }
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  if (!document.fullscreenEnabled) return null
  return (
    <button type="button" className="btn-secondary text-xs px-2 sm:px-3 shrink-0" title={error ? 'Nie udało się włączyć pełnego ekranu. Spróbuj ponownie.' : undefined}
      aria-label={fullscreen ? 'Wyłącz pełny ekran' : 'Pełny ekran'} aria-pressed={fullscreen}
      onClick={async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen()
          else await document.documentElement.requestFullscreen()
        } catch { setError(true) }
      }}>
      {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      <span className="hidden sm:inline">{error ? 'Spróbuj ponownie' : fullscreen ? 'Zwiń ekran' : 'Pełny ekran'}</span>
    </button>
  )
}
