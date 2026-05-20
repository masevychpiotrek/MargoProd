import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'

export interface TutorialStep {
  id: string
  target: string // data-tutorial attribute value
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

const OPERATOR_STEPS: TutorialStep[] = [
  {
    id: 'sidebar',
    target: 'sidebar-nav',
    title: 'Nawigacja',
    description: 'Tu znajdziesz wszystkie sekcje aplikacji. Możesz zwinąć menu przyciskiem ☰ w górnym pasku.',
    position: 'right'
  },
  {
    id: 'shift-link',
    target: 'nav-shift',
    title: 'Moja zmiana',
    description: 'Tutaj rozpoczynasz i kończysz zmianę produkcyjną. Zacznij od kliknięcia tej pozycji.',
    position: 'right'
  },
  {
    id: 'machine',
    target: 'shift-machine',
    title: 'Wybór maszyny',
    description: 'Wybierz maszynę przy której pracujesz — Automat 3 lub Automat 4.',
    position: 'bottom'
  },
  {
    id: 'shift-type',
    target: 'shift-type',
    title: 'Wybór zmiany',
    description: 'Wybierz swoją zmianę — I (06–14), II (14–22) lub III (22–06). System podpowiada aktualną zmianę.',
    position: 'bottom'
  },
  {
    id: 'start-btn',
    target: 'shift-start-btn',
    title: 'Rozpocznij zmianę',
    description: 'Kliknij ten przycisk gdy jesteś gotowy. Zmiana zostanie zarejestrowana z aktualną godziną.',
    position: 'top'
  },
  {
    id: 'report-link',
    target: 'nav-report',
    title: 'Wpisz wynik',
    description: 'Co godzinę wpisujesz tutaj ile sztuk wyprodukowano i ile było odrzutów.',
    position: 'right'
  },
  {
    id: 'alert',
    target: 'tutorial-alert-info',
    title: 'Przypomnienia godzinowe',
    description: 'System automatycznie przypomni Ci o wpisaniu wyniku pod koniec każdej godziny. Nie zapomnisz! 🔔',
    position: 'top'
  }
]

interface TutorialContextType {
  isActive: boolean
  currentStep: number
  steps: TutorialStep[]
  startTutorial: () => void
  nextStep: () => void
  prevStep: () => void
  skipTutorial: () => void
}

const TutorialContext = createContext<TutorialContextType | null>(null)

export function useTutorial() {
  const ctx = useContext(TutorialContext)
  if (!ctx) throw new Error('useTutorial must be used inside TutorialProvider')
  return ctx
}

const TUTORIAL_KEY = 'margoprod-tutorial-done'

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore()
  const [isActive, setIsActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  // Auto-start dla operatora i managera przy pierwszym logowaniu
  useEffect(() => {
    if (!profile) return
    if (profile.role === 'admin') return // admin nie dostaje samouczka

    const key = `${TUTORIAL_KEY}-${profile.id}`
    const done = localStorage.getItem(key)
    if (!done) {
      // Krótkie opóźnienie żeby UI zdążyło się załadować
      const t = setTimeout(() => setIsActive(true), 1200)
      return () => clearTimeout(t)
    }
  }, [profile])

  const startTutorial = useCallback(() => {
    setCurrentStep(0)
    setIsActive(true)
  }, [])

  const nextStep = useCallback(() => {
    setCurrentStep(s => {
      if (s >= OPERATOR_STEPS.length - 1) {
        // Koniec samouczka
        setIsActive(false)
        if (profile?.id) {
          localStorage.setItem(`${TUTORIAL_KEY}-${profile.id}`, '1')
        }
        return 0
      }
      return s + 1
    })
  }, [profile?.id])

  const prevStep = useCallback(() => {
    setCurrentStep(s => Math.max(0, s - 1))
  }, [])

  const skipTutorial = useCallback(() => {
    setIsActive(false)
    setCurrentStep(0)
    if (profile?.id) {
      localStorage.setItem(`${TUTORIAL_KEY}-${profile.id}`, '1')
    }
  }, [profile?.id])

  return (
    <TutorialContext.Provider value={{
      isActive,
      currentStep,
      steps: OPERATOR_STEPS,
      startTutorial,
      nextStep,
      prevStep,
      skipTutorial
    }}>
      {children}
    </TutorialContext.Provider>
  )
}
