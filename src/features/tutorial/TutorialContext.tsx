import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'

export interface TutorialStep {
  id: string
  target: string
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
  navigateTo?: string
  waitForShift?: 'active' | 'none' // poczekaj na zmianę aktywną lub brak aktywnej
}

// Kroki BEZ aktywnej zmiany
const STEPS_NO_SHIFT: TutorialStep[] = [
  {
    id: 'sidebar',
    target: 'sidebar-nav',
    title: 'Nawigacja',
    description: 'Tu znajdziesz wszystkie sekcje aplikacji. Możesz zwinąć menu przyciskiem ☰ w górnym pasku.',
    position: 'right',
    navigateTo: '/operator'
  },
  {
    id: 'shift-link',
    target: 'nav-shift',
    title: 'Moja zmiana',
    description: 'Tutaj rozpoczynasz i kończysz zmianę produkcyjną. Kliknij tę pozycję żeby zacząć.',
    position: 'right',
    navigateTo: '/operator'
  },
  {
    id: 'machine',
    target: 'shift-machine',
    title: 'Krok 1 — Wybierz maszynę',
    description: 'Kliknij maszynę przy której pracujesz — Automat 3 lub Automat 4.',
    position: 'bottom',
    navigateTo: '/operator/shift'
  },
  {
    id: 'shift-type',
    target: 'shift-type',
    title: 'Krok 2 — Wybierz zmianę',
    description: 'Wybierz swoją zmianę — I (06–14), II (14–22) lub III (22–06). System automatycznie zaznacza aktualną zmianę.',
    position: 'bottom',
    navigateTo: '/operator/shift'
  },
  {
    id: 'start-btn',
    target: 'shift-start-btn',
    title: 'Krok 3 — Rozpocznij zmianę',
    description: 'Kliknij ten przycisk gdy wybrałeś maszynę i zmianę. Zmiana zostanie zarejestrowana z aktualną godziną. Po kliknięciu przejdziemy dalej.',
    position: 'top',
    navigateTo: '/operator/shift',
    waitForShift: 'active'
  },
]

// Kroki Z aktywną zmianą
const STEPS_WITH_SHIFT: TutorialStep[] = [
  {
    id: 'report-link',
    target: 'nav-report',
    title: 'Krok 4 — Wpisz wynik',
    description: 'Co godzinę klikasz tutaj i wpisujesz wyniki produkcji. System pilnuje żebyś nie zapomniał — przypomni Ci alertem.',
    position: 'right',
    navigateTo: '/operator/shift'
  },
  {
    id: 'counter-good',
    target: 'report-counter-good',
    title: 'Krok 5 — Licznik dobrych sztuk',
    description: 'Wpisz aktualny stan licznika dobrych sztuk z maszyny. System sam policzy przyrost od ostatniego raportu.',
    position: 'right',
    navigateTo: '/operator/report'
  },
  {
    id: 'counter-times',
    target: 'report-counter-times',
    title: 'Krok 6 — Liczniki czasów',
    description: 'Wpisz stan liczników czasu pracy, gotowości i alarmu w formacie HH:MM. Suma przyrostów musi wynosić 01:00.',
    position: 'top',
    navigateTo: '/operator/report'
  },
  {
    id: 'save-btn',
    target: 'report-save-btn',
    title: 'Krok 7 — Zapisz raport',
    description: 'Kliknij ten przycisk żeby zapisać raport godzinowy. Dane trafią do systemu i będą widoczne dla kierownika.',
    position: 'top',
    navigateTo: '/operator/report'
  },
  {
    id: 'end-shift',
    target: 'shift-end-btn',
    title: 'Krok 8 — Zakończ zmianę',
    description: 'Po zakończeniu pracy kliknij tutaj. System sprawdzi czy wpisałeś wszystkie godziny i poprosi o potwierdzenie.',
    position: 'top',
    navigateTo: '/operator/shift'
  },
]

interface TutorialContextType {
  isActive: boolean
  currentStep: number
  steps: TutorialStep[]
  startTutorial: () => void
  nextStep: () => void
  prevStep: () => void
  skipTutorial: () => void
  advanceIfWaitingForShift: () => void
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
  const { activeShift } = useShiftStore()
  const navigate = useNavigate()
  const [isActive, setIsActive] = useState(false)
  const [phase, setPhase] = useState<'no-shift' | 'with-shift'>('no-shift')
  const [currentStep, setCurrentStep] = useState(0)
  const waitingForShift = useRef(false)

  const steps = phase === 'no-shift' ? STEPS_NO_SHIFT : STEPS_WITH_SHIFT

  // Nawiguj przy zmianie kroku
  useEffect(() => {
    if (!isActive) return
    const step = steps[currentStep]
    if (step?.navigateTo) {
      navigate(step.navigateTo)
    }
  }, [isActive, currentStep, phase]) // eslint-disable-line

  // Auto-start przy pierwszym logowaniu
  useEffect(() => {
    if (!profile) return
    if (profile.role === 'admin') return
    const key = `${TUTORIAL_KEY}-${profile.id}`
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => {
        setPhase('no-shift')
        setCurrentStep(0)
        setIsActive(true)
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [profile])

  const startTutorial = useCallback(() => {
    setPhase(activeShift ? 'with-shift' : 'no-shift')
    setCurrentStep(0)
    setIsActive(true)
  }, [activeShift])

  // Wywoływane przez Shift.tsx po faktycznym uruchomieniu zmiany
  const advanceIfWaitingForShift = useCallback(() => {
    if (!waitingForShift.current) return
    waitingForShift.current = false
    // Przejdź do fazy z aktywną zmianą
    setPhase('with-shift')
    setCurrentStep(0)
  }, [])

  const nextStep = useCallback(() => {
    const step = steps[currentStep]

    // Jeśli krok czeka na aktywną zmianę — ustaw flagę i zablokuj przejście
    if (step?.waitForShift === 'active') {
      waitingForShift.current = true
      // Tooltip zmienia opis na "czekam..."
      return
    }

    const next = currentStep + 1
    if (next >= steps.length) {
      if (phase === 'no-shift') {
        // Przejdź do fazy z aktywną zmianą jeśli zmiana jest już aktywna
        if (activeShift) {
          setPhase('with-shift')
          setCurrentStep(0)
        } else {
          // Zakończ — operator jeszcze nie ma zmiany
          finishTutorial()
        }
      } else {
        finishTutorial()
      }
      return
    }
    setCurrentStep(next)
  }, [currentStep, steps, phase, activeShift]) // eslint-disable-line

  const prevStep = useCallback(() => {
    if (currentStep === 0 && phase === 'with-shift') {
      setPhase('no-shift')
      setCurrentStep(STEPS_NO_SHIFT.length - 1)
      return
    }
    setCurrentStep(s => Math.max(0, s - 1))
  }, [currentStep, phase])

  const finishTutorial = () => {
    setIsActive(false)
    setCurrentStep(0)
    if (profile?.id) {
      localStorage.setItem(`${TUTORIAL_KEY}-${profile.id}`, '1')
    }
  }

  const skipTutorial = useCallback(() => {
    if (!window.confirm('Czy na pewno chcesz pominąć samouczek?\n\nMożesz go uruchomić ponownie przyciskiem 🎓 w menu.')) return
    waitingForShift.current = false
    finishTutorial()
  }, [profile?.id]) // eslint-disable-line

  // Globalny numer kroku dla paska postępu
  const globalStep = phase === 'no-shift' ? currentStep : STEPS_NO_SHIFT.length + currentStep

  return (
    <TutorialContext.Provider value={{
      isActive,
      currentStep: globalStep,
      steps: [...STEPS_NO_SHIFT, ...STEPS_WITH_SHIFT],
      startTutorial,
      nextStep,
      prevStep,
      skipTutorial,
      advanceIfWaitingForShift
    }}>
      {children}
    </TutorialContext.Provider>
  )
}
