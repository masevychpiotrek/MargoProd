import { useEffect, useState, useCallback } from 'react'
import { useTutorial } from './TutorialContext'
import { cn } from '@/lib/utils'

interface TooltipPosition {
  top: number
  left: number
  arrowDir: 'top' | 'bottom' | 'left' | 'right'
}

function getTooltipPosition(targetEl: Element, preferredPos: string): TooltipPosition {
  const rect = targetEl.getBoundingClientRect()
  const tooltipW = 300
  const tooltipH = 180
  const gap = 16
  const arrowSize = 10
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0
  let arrowDir = preferredPos as TooltipPosition['arrowDir']

  switch (preferredPos) {
    case 'right':
      top = rect.top + rect.height / 2 - tooltipH / 2
      left = rect.right + gap + arrowSize
      // Jeśli nie mieści się po prawej — idź w lewo
      if (left + tooltipW > vw - 16) {
        left = rect.left - tooltipW - gap - arrowSize
        arrowDir = 'right'
      }
      break
    case 'left':
      top = rect.top + rect.height / 2 - tooltipH / 2
      left = rect.left - tooltipW - gap - arrowSize
      arrowDir = 'right'
      break
    case 'bottom':
      top = rect.bottom + gap + arrowSize
      left = rect.left + rect.width / 2 - tooltipW / 2
      arrowDir = 'top'
      break
    case 'top':
    default:
      top = rect.top - tooltipH - gap - arrowSize
      left = rect.left + rect.width / 2 - tooltipW / 2
      arrowDir = 'bottom'
      break
  }

  // Ogranicz żeby tooltip nie wychodził poza ekran
  top = Math.max(16, Math.min(top, vh - tooltipH - 16))
  left = Math.max(16, Math.min(left, vw - tooltipW - 16))

  return { top, left, arrowDir }
}

function ArrowClass(arrowDir: string): string {
  const base = 'absolute w-3 h-3 bg-navy-800 border-brand/40 rotate-45'
  switch (arrowDir) {
    case 'left':   return `${base} -left-[7px] top-1/2 -translate-y-1/2 border-l border-b`
    case 'right':  return `${base} -right-[7px] top-1/2 -translate-y-1/2 border-r border-t`
    case 'top':    return `${base} -top-[7px] left-1/2 -translate-x-1/2 border-t border-l`
    case 'bottom': return `${base} -bottom-[7px] left-1/2 -translate-x-1/2 border-b border-r`
    default:       return base
  }
}

export function TutorialOverlay() {
  const { isActive, currentStep, steps, nextStep, prevStep, skipTutorial } = useTutorial()
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [visible, setVisible] = useState(false)

  const step = steps[currentStep]

  const updatePosition = useCallback(() => {
    if (!step) return
    const el = document.querySelector(`[data-tutorial="${step.target}"]`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    setHighlightRect(rect)
    setTooltipPos(getTooltipPosition(el, step.position))
  }, [step])

  useEffect(() => {
    if (!isActive) {
      setVisible(false)
      return
    }
    setVisible(false)
    // Daj czas na nawigację i render strony docelowej
    const t1 = setTimeout(updatePosition, 400)
    const t2 = setTimeout(() => setVisible(true), 500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isActive, currentStep, updatePosition])

  useEffect(() => {
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [updatePosition])

  // ESC nie zamyka — tylko przycisk Pomiń
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isActive) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep()
      if (e.key === 'ArrowLeft') prevStep()
      // ESC daje potwierdzenie przez skipTutorial (które samo pyta)
      if (e.key === 'Escape') skipTutorial()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, nextStep, prevStep, skipTutorial])

  if (!isActive || !step) return null

  const isLast = currentStep === steps.length - 1
  const isFirst = currentStep === 0

  return (
    <>
      {/* Ciemne tło — NIE reaguje na kliknięcia (pointer-events-none) */}
      <div className="fixed inset-0 z-[9998] pointer-events-none">
        {highlightRect && (
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <mask id="tutorial-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={highlightRect.left - 8}
                  y={highlightRect.top - 8}
                  width={highlightRect.width + 16}
                  height={highlightRect.height + 16}
                  rx="14"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(7,8,13,0.80)"
              mask="url(#tutorial-mask)"
            />
            {/* Animowana ramka wokół podświetlonego elementu */}
            <rect
              x={highlightRect.left - 8}
              y={highlightRect.top - 8}
              width={highlightRect.width + 16}
              height={highlightRect.height + 16}
              rx="14"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
              strokeDasharray="8 4"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="24" dur="1s" repeatCount="indefinite" />
            </rect>
          </svg>
        )}
      </div>

      {/* Tooltip — pointer-events: auto żeby można klikać przyciski */}
      {tooltipPos && (
        <div
          className={cn(
            'fixed z-[10000] w-[300px] transition-all duration-300',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="relative bg-navy-800 border border-brand/40 rounded-2xl shadow-2xl shadow-black/40 p-5">
            {/* Strzałka */}
            <div className={ArrowClass(tooltipPos.arrowDir)} />

            {/* Pasek postępu */}
            <div className="flex items-center gap-1.5 mb-4">
              {steps.map((_, i) => (
                <div key={i} className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i < currentStep ? 'bg-brand/40' :
                  i === currentStep ? 'bg-brand flex-[2]' : 'bg-navy-600'
                )} style={{ flex: i === currentStep ? 2 : 1 }} />
              ))}
            </div>

            {/* Numer kroku */}
            <div className="text-xs font-bold text-brand uppercase tracking-widest mb-1">
              Krok {currentStep + 1} z {steps.length}
            </div>

            {/* Tytuł i opis */}
            <h3 className="text-white font-bold text-base mb-2">{step.title}</h3>
            <p className="text-navy-300 text-sm leading-relaxed">{step.description}</p>

            {/* Przyciski nawigacji */}
            <div className="flex items-center gap-2 mt-5">
              {!isFirst && (
                <button
                  onClick={prevStep}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-navy-400 hover:text-white hover:bg-navy-700 transition-all"
                >
                  ← Wstecz
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={skipTutorial}
                className="px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-red-400 transition-all"
              >
                Pomiń
              </button>
              <button
                onClick={nextStep}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-brand hover:bg-blue-500 text-white transition-all shadow-lg shadow-brand/30"
              >
                {isLast ? '✓ Zakończ' : 'Dalej →'}
              </button>
            </div>

            {/* Podpowiedź klawiaturowa */}
            <div className="mt-3 text-xs text-navy-600 text-center">
              ← → klawiaturą · ESC = pomiń
            </div>
          </div>
        </div>
      )}
    </>
  )
}
