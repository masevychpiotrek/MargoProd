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
  const tooltipW = 310
  const tooltipH = 200
  const gap = 16
  const arrowSize = 10
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0, left = 0
  let arrowDir = preferredPos as TooltipPosition['arrowDir']

  switch (preferredPos) {
    case 'right':
      top = rect.top + rect.height / 2 - tooltipH / 2
      left = rect.right + gap + arrowSize
      if (left + tooltipW > vw - 16) { left = rect.left - tooltipW - gap - arrowSize; arrowDir = 'right' }
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

  top = Math.max(16, Math.min(top, vh - tooltipH - 16))
  left = Math.max(16, Math.min(left, vw - tooltipW - 16))
  return { top, left, arrowDir }
}

function ArrowClass(arrowDir: string): string {
  const base = 'absolute w-3 h-3 bg-navy-800 rotate-45'
  switch (arrowDir) {
    case 'left':   return `${base} -left-[7px] top-1/2 -translate-y-1/2 border-l border-b border-brand/40`
    case 'right':  return `${base} -right-[7px] top-1/2 -translate-y-1/2 border-r border-t border-brand/40`
    case 'top':    return `${base} -top-[7px] left-1/2 -translate-x-1/2 border-t border-l border-brand/40`
    case 'bottom': return `${base} -bottom-[7px] left-1/2 -translate-x-1/2 border-b border-r border-brand/40`
    default:       return base
  }
}

// Kroki które czekają na akcję użytkownika (przycisk Dalej jest zablokowany)
const WAITING_STEP_IDS = ['start-btn']

export function TutorialOverlay() {
  const { isActive, currentStep, steps, nextStep, prevStep, skipTutorial } = useTutorial()
  const [tooltipPos, setTooltipPos]     = useState<TooltipPosition | null>(null)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [visible, setVisible]           = useState(false)
  const [isWaiting, setIsWaiting]       = useState(false)

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
    if (!isActive) { setVisible(false); return }
    setVisible(false)
    setIsWaiting(false)
    const t1 = setTimeout(updatePosition, 450)
    const t2 = setTimeout(() => setVisible(true), 550)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isActive, currentStep, updatePosition])

  useEffect(() => {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition)
    }
  }, [updatePosition])

  // Klawiatura
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isActive) return
      if ((e.key === 'ArrowRight' || e.key === 'Enter') && !isWaiting) nextStep()
      if (e.key === 'ArrowLeft') prevStep()
      if (e.key === 'Escape') skipTutorial()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, isWaiting, nextStep, prevStep, skipTutorial])

  const handleNext = () => {
    if (step?.id && WAITING_STEP_IDS.includes(step.id)) {
      // Nie blokujemy — nextStep sam ustawi waitForShift
      // Tooltip zmieni się na "oczekiwanie"
      setIsWaiting(true)
      nextStep()
      return
    }
    nextStep()
  }

  if (!isActive || !step) return null

  const isLast = currentStep === steps.length - 1
  const isFirst = currentStep === 0
  const totalSteps = steps.length

  return (
    <>
      {/* Ciemne tło — pointer-events-none, NIE blokuje kliknięć w aplikację */}
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
                  rx="12"
                  fill="black"
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(7,8,13,0.78)" mask="url(#tutorial-mask)" />
            {/* Animowana ramka */}
            <rect
              x={highlightRect.left - 8}
              y={highlightRect.top - 8}
              width={highlightRect.width + 16}
              height={highlightRect.height + 16}
              rx="12"
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

      {/* Tooltip — ma pointer-events żeby można klikać przyciski */}
      {tooltipPos && (
        <div
          className={cn(
            'fixed z-[10000] w-[310px] transition-all duration-300',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          )}
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="relative bg-navy-800 border border-brand/40 rounded-2xl shadow-2xl shadow-black/50 p-5">
            <div className={ArrowClass(tooltipPos.arrowDir)} />

            {/* Pasek postępu */}
            <div className="flex items-center gap-1 mb-4">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 rounded-full transition-all duration-300',
                    i < currentStep  ? 'bg-brand/50' :
                    i === currentStep ? 'bg-brand' : 'bg-navy-600'
                  )}
                  style={{ flex: i === currentStep ? 2 : 1 }}
                />
              ))}
            </div>

            {/* Krok */}
            <div className="text-xs font-bold text-brand uppercase tracking-widest mb-1">
              {currentStep + 1} / {totalSteps}
            </div>

            {/* Tytuł */}
            <h3 className="text-white font-bold text-base mb-2">{step.title}</h3>

            {/* Opis — zmienia się gdy czekamy na akcję */}
            {isWaiting ? (
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Czekam aż klikniesz "Rozpocznij zmianę"...
              </div>
            ) : (
              <p className="text-navy-300 text-sm leading-relaxed">{step.description}</p>
            )}

            {/* Przyciski */}
            {!isWaiting && (
              <div className="flex items-center gap-2 mt-5">
                {!isFirst && (
                  <button onClick={prevStep}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-navy-400 hover:text-white hover:bg-navy-700 transition-all">
                    ← Wstecz
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={skipTutorial}
                  className="px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-red-400 transition-all">
                  Pomiń
                </button>
                <button onClick={handleNext}
                  className="px-5 py-2 rounded-lg text-xs font-bold bg-brand hover:bg-blue-500 text-white transition-all shadow-lg shadow-brand/30">
                  {isLast ? '✓ Zakończ' : step.id === 'start-btn' ? 'Kliknij Rozpocznij →' : 'Dalej →'}
                </button>
              </div>
            )}

            {isWaiting && (
              <button onClick={skipTutorial}
                className="mt-4 px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-red-400 transition-all w-full text-center">
                Pomiń samouczek
              </button>
            )}

            {/* Podpowiedź klawiaturowa */}
            {!isWaiting && (
              <div className="mt-3 text-xs text-navy-600 text-center">
                ← → klawiaturą · ESC = pomiń
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
