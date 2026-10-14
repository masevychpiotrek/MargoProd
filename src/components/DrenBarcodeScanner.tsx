import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { IScannerControls } from '@zxing/browser'
import { isPlausibleBatchNumber } from '@/lib/productionJobs'
import { decodeBarcodeOrientations } from '@/lib/barcodeOrientation'

export default function DrenBarcodeScanner({ label, onDetected, onClose }: {
  label: string
  onDetected: (value: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const callbacks = useRef({ onDetected, onClose })
  callbacks.current = { onDetected, onClose }

  useEffect(() => {
    let disposed = false
    let detected = false
    let stream: MediaStream | undefined
    let controls: IScannerControls | undefined
    const stop = () => {
      controls?.stop()
      stream?.getTracks().forEach(track => track.stop())
    }
    const start = async () => {
      setError('')
      setReady(false)
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Aparat wymaga otwarcia aplikacji przez HTTPS w przeglądarce obsługującej kamerę.')
        }
        const { BrowserMultiFormatOneDReader } = await import('@zxing/browser')
        if (disposed) return
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        })
        if (disposed) { stop(); return }
        class DrenReader extends BrowserMultiFormatOneDReader {
          decodeFromCanvas(canvas: HTMLCanvasElement) {
            return decodeBarcodeOrientations(canvas, frame => super.decodeFromCanvas(frame))
          }
        }
        const reader = new DrenReader(undefined, {
          delayBetweenScanAttempts: 150,
          delayBetweenScanSuccess: 500
        })
        controls = await reader.decodeFromStream(stream, videoRef.current!, (result, _error, scannerControls) => {
          if (!result || disposed || detected) return
          const value = result.getText().trim()
          if (!isPlausibleBatchNumber(value) || /[\r\n\x00-\x1f]/.test(value)) {
            setError('Kod nie zawiera poprawnego numeru serii. Zeskanuj etykietę drenu ponownie.')
            return
          }
          detected = true
          scannerControls.stop()
          stop()
          callbacks.current.onDetected(value)
        })
        if (disposed || detected) { stop(); return }
        setReady(true)
      } catch (cause) {
        stop()
        if (disposed) return
        const name = cause instanceof Error ? cause.name : ''
        setError(name === 'NotAllowedError'
          ? 'Brak dostępu do aparatu. Zezwól na używanie kamery w ustawieniach przeglądarki i spróbuj ponownie.'
          : name === 'NotFoundError'
            ? 'Nie znaleziono aparatu. Otwórz aplikację na telefonie lub urządzeniu z kamerą.'
            : name === 'NotReadableError'
              ? 'Aparat jest zajęty. Zamknij inne aplikacje korzystające z kamery i spróbuj ponownie.'
              : cause instanceof Error ? cause.message : 'Nie udało się uruchomić aparatu. Spróbuj ponownie.')
      }
    }
    void start()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') callbacks.current.onClose() }
    const onVisibility = () => { if (document.hidden) callbacks.current.onClose() }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      stop()
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [attempt])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90">
      <div role="dialog" aria-modal="true" aria-labelledby="dren-scanner-title" className="w-full max-w-lg rounded-2xl border border-navy-600 bg-navy-800 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dren-scanner-title" className="text-lg font-bold text-white">Skanuj dren — {label}</h2>
          <button onClick={onClose} aria-label="Zamknij skaner" className="btn-secondary p-2" autoFocus><X size={20} /></button>
        </div>
        <p className="text-sm text-navy-300">Skieruj aparat na kod kreskowy z numerem serii. Po odczycie sprawdź numer i zatwierdź zapis.</p>
        <video ref={videoRef} muted autoPlay playsInline className="w-full rounded-xl bg-black aspect-video object-contain" />
        {!ready && !error && <p role="status" className="text-sm text-navy-300">Uruchamianie aparatu...</p>}
        {ready && !error && <p role="status" className="text-sm text-navy-300">Umieść cały kod w kadrze, pozostaw jasny margines po obu stronach i przytrzymaj telefon nieruchomo. Kod może być poziomo lub pionowo.</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {error && <button onClick={() => setAttempt(value => value + 1)} className="btn-primary w-full">Spróbuj ponownie</button>}
        <button onClick={onClose} className="btn-secondary w-full">Anuluj skanowanie</button>
      </div>
    </div>
  )
}
