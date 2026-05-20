import { useEffect, useState, useCallback } from 'react'
import { useTutorial } from './TutorialContext'
import { cn } from '@/lib/utils'

interface TooltipPos {
  top: number
  left: number
  arrow: 'top' | 'bottom' | 'left' | 'right'
}

function calcPosition(el: Element, preferred: string): TooltipPos {
  const rect = el.getBoundingClientRect()
  const W = 320, H = 210, gap = 14, arr = 10
  const vw = window.innerWidth, vh = window.innerHeight
  let top = 0, left = 0, arrow = preferred as TooltipPos['arrow']

  switch (preferred) {
    case 'right':
      top  = rect.top + rect.height / 2 - H / 2
      left = rect.right + gap + arr
      if (left + W > vw - 12) { left = rect.left - W - gap - arr; arrow = 'right' }
      break
    case 'left':
      top  = rect.top + rect.height / 2 - H / 2
      left = rect.left - W - gap - arr
      arrow = 'right'
      break
    case 'bottom':
      top  = rect.bottom + gap + arr
      left = rect.left + rect.width / 2 - W / 2
      arrow = 'top'
      break
    default: // top
      top  = rect.top - H - gap - arr
      left = rect.left + rect.width / 2 - W / 2
      arrow = 'bottom'
  }

  top  = Math.max(12, Math.min(top,  vh - H  - 12))
  left = Math.max(12, Math.min(left, vw - W - 12))
  return { top, left, arrow }
}

function arrowCls(arrow: string) {
  const b = 'absolute w-3 h-3 bg-navy-800 rotate-45 border-brand/30'
  switch (arrow) {
    case 'left':   return `${b} -left-[7px]   top-1/2 -translate-y-1/2 border-l border-b`
    case 'right':  return `${b} -right-[7px]  top-1/2 -translate-y-1/2 border-r border-t`
    case 'top':    return `${b} -top-[7px]    left-1/2 -translate-x-1/2 border-t border-l`
    default:       return `${b} -bottom-[7px] left-1/2 -translate-x-1/2 border-b border-r`
  }
}

export function TutorialOverlay() {
  const { isActive, currentStep, totalSteps, step, isWaiting, nextStep, prevStep, skipTutorial } = useTutorial()
  const [pos,           setPos]           = useState<TooltipPos | null>(null)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [visible,       setVisible]       = useState(false)

  const update = useCallback(() => {
    if (!step) return
    const el = document.querySelector(`[data-tutorial="${step.target}"]`)
    if (!el) return
    setHighlightRect(el.getBoundingClientRect())
    setPos(calcPosition(el, step.position))
  }, [step])

  useEffect(() => {
    if (!isActive) { setVisible(false); return }
    setVisible(false)
    const t1 = setTimeout(update,   450)
    const t2 = setTimeout(() => setVisible(true), 560)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isActive, currentStep, update])

  useEffect(() => {
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update) }
  }, [update])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isActive) return
      if (e.key === 'ArrowRight' && !isWaiting) nextStep()
      if (e.key === 'ArrowLeft')  prevStep()
      if (e.key === 'Escape')     skipTutorial()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isActive, isWaiting, nextStep, prevStep, skipTutorial])

  if (!isActive || !step) return null

  const isFirst = currentStep === 0
  const isLast  = currentStep === totalSteps - 1

  return (
    <>
      {/* Ciemne tło — pointer-events-none, nie blokuje kliknięć */}
      <div className="fixed inset-0 z-[9998] pointer-events-none">
        {highlightRect && (
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <mask id="tmask">
                <rect width="100%" height="100%" fill="white" />
                <rect x={highlightRect.left - 8} y={highlightRect.top - 8}
                  width={highlightRect.width + 16} height={highlightRect.height + 16}
                  rx="12" fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(7,8,13,0.80)" mask="url(#tmask)" />
            <rect x={highlightRect.left - 8} y={highlightRect.top - 8}
              width={highlightRect.width + 16} height={highlightRect.height + 16}
              rx="12" fill="none" stroke="#3B82F6" strokeWidth="2" strokeDasharray="8 4">
              <animate attributeName="stroke-dashoffset" from="0" to="24" dur="1s" repeatCount="indefinite" />
            </rect>
          </svg>
        )}
      </div>

      {/* Tooltip */}
      {pos && (
        <div
          className={cn(
            'fixed z-[10000] w-[320px] transition-all duration-300 ease-out',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          )}
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="relative bg-navy-800 border border-brand/40 rounded-2xl shadow-2xl shadow-black/50 p-5">
            <div className={arrowCls(pos.arrow)} />

            {/* Pasek postępu */}
            <div className="flex items-center gap-1 mb-4">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div key={i}
                  className={cn('h-1 rounded-full transition-all duration-300',
                    i < currentStep  ? 'bg-brand/40' :
                    i === currentStep ? 'bg-brand' : 'bg-navy-600'
                  )}
                  style={{ flex: i === currentStep ? 2 : 1 }}
                />
              ))}
            </div>

            <div className="text-xs font-bold text-brand uppercase tracking-widest mb-1">
              {currentStep + 1} / {totalSteps}
            </div>

            <h3 className="text-white font-bold text-base mb-2">{step.title}</h3>

            {/* Opis lub spinner oczekiwania */}
            {isWaiting ? (
              <div className="flex items-start gap-2 text-amber-400 text-sm">
                <svg className="animate-spin h-4 w-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span>{step.waitDescription ?? 'Wykonaj akcję żeby przejść dalej...'}</span>
              </div>
            ) : (
              <p className="text-navy-300 text-sm leading-relaxed">{step.description}</p>
            )}

            {/* Przyciski */}
            <div className="flex items-center gap-2 mt-5">
              {!isFirst && !isWaiting && (
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
              {!isWaiting && (
                <button onClick={nextStep}
                  className="px-5 py-2 rounded-lg text-xs font-bold bg-brand hover:bg-blue-500 text-white transition-all shadow-lg shadow-brand/30">
                  {isLast ? '✓ Zakończ' : 'Dalej →'}
                </button>
              )}
            </div>

            {!isWaiting && (
              <div className="mt-3 text-xs text-navy-600 text-center">← → klawiaturą · ESC = pomiń</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
