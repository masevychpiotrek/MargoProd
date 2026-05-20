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
  const tooltipH = 160
  const gap = 16
  const arrowSize = 10

  switch (preferredPos) {
    case 'right':
      return {
        top: rect.top + rect.height / 2 - tooltipH / 2,
        left: rect.right + gap + arrowSize,
        arrowDir: 'left'
      }
    case 'left':
      return {
        top: rect.top + rect.height / 2 - tooltipH / 2,
        left: rect.left - tooltipW - gap - arrowSize,
        arrowDir: 'right'
      }
    case 'bottom':
      return {
        top: rect.bottom + gap + arrowSize,
        left: rect.left + rect.width / 2 - tooltipW / 2,
        arrowDir: 'top'
      }
    case 'top':
    default:
      return {
        top: rect.top - tooltipH - gap - arrowSize,
        left: rect.left + rect.width / 2 - tooltipW / 2,
        arrowDir: 'bottom'
      }
  }
}

function getArrowStyle(arrowDir: string, targetRect: DOMRect, tooltipPos: TooltipPosition) {
  const base = 'absolute w-3 h-3 bg-brand rotate-45'
  switch (arrowDir) {
    case 'left':  return `${base} -left-1.5 top-1/2 -translate-y-1/2`
    case 'right': return `${base} -right-1.5 top-1/2 -translate-y-1/2`
    case 'top':   return `${base} -top-1.5 left-1/2 -translate-x-1/2`
    case 'bottom':return `${base} -bottom-1.5 left-1/2 -translate-x-1/2`
    default:      return base
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
    const t = setTimeout(() => {
      updatePosition()
      setVisible(true)
    }, 200)
    return () => clearTimeout(t)
  }, [isActive, currentStep, updatePosition])

  useEffect(() => {
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [updatePosition])

  if (!isActive || !step) return null

  const isLast = currentStep === steps.length - 1
  const isFirst = currentStep === 0

  return (
    <>
      {/* Ciemne tło z dziurą na podświetlony element */}
      <div className="fixed inset-0 z-[9998] pointer-events-none">
        {highlightRect && (
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <mask id="tutorial-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={highlightRect.left - 6}
                  y={highlightRect.top - 6}
                  width={highlightRect.width + 12}
                  height={highlightRect.height + 12}
                  rx="12"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(7,8,13,0.75)"
              mask="url(#tutorial-mask)"
            />
            {/* Podświetlona ramka */}
            <rect
              x={highlightRect.left - 6}
              y={highlightRect.top - 6}
              width={highlightRect.width + 12}
              height={highlightRect.height + 12}
              rx="12"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
              strokeDasharray="6 3"
            />
          </svg>
        )}
      </div>

      {/* Kliknięcie tła = pomiń */}
      <div
        className="fixed inset-0 z-[9999] cursor-pointer"
        onClick={skipTutorial}
      />

      {/* Tooltip */}
      {tooltipPos && (
        <div
          className={cn(
            'fixed z-[10000] w-[300px] transition-all duration-200',
            visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          )}
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
          onClick={e => e.stopPropagation()}
        >
          <div className="relative bg-navy-800 border border-brand/40 rounded-2xl shadow-2xl shadow-brand/20 p-5">
            {/* Strzałka */}
            {highlightRect && (
              <div className={getArrowStyle(tooltipPos.arrowDir, highlightRect, tooltipPos)} />
            )}

            {/* Postęp */}
            <div className="flex items-center gap-2 mb-3">
              {steps.map((_, i) => (
                <div key={i} className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === currentStep ? 'bg-brand flex-1' : 'bg-navy-600 w-4'
                )} />
              ))}
            </div>

            {/* Treść */}
            <div className="text-xs font-bold text-brand uppercase tracking-widest mb-1">
              Krok {currentStep + 1} z {steps.length}
            </div>
            <h3 className="text-white font-bold text-base mb-2">{step.title}</h3>
            <p className="text-navy-300 text-sm leading-relaxed">{step.description}</p>

            {/* Przyciski */}
            <div className="flex items-center gap-2 mt-4">
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
                className="px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-navy-300 transition-all"
              >
                Pomiń
              </button>
              <button
                onClick={nextStep}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-brand hover:bg-brand/80 text-white transition-all"
              >
                {isLast ? '✓ Zakończ' : 'Dalej →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
