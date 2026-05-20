import {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WaitCondition =
  | 'none'
  | 'machine-selected'
  | 'shift-selected'
  | 'shift-started'
  | 'value-entered'    // generic — sprawdzane zewnętrznie
  | 'report-saved'
  | 'shift-ended'

export interface TutorialStep {
  id: string
  target: string                          // data-tutorial attribute
  title: string
  description: string
  waitDescription?: string                // tekst gdy czekamy na akcję
  position: 'top' | 'bottom' | 'left' | 'right'
  navigateTo?: string
  wait?: WaitCondition
  role: 'operator' | 'manager' | 'both'
}

// ─── Operator steps ───────────────────────────────────────────────────────────

const OPERATOR_STEPS: TutorialStep[] = [
  {
    id: 'sidebar',
    target: 'sidebar-nav',
    title: 'Nawigacja',
    description: 'Tu znajdziesz wszystkie sekcje aplikacji. Możesz zwinąć menu przyciskiem ☰ w górnym pasku.',
    position: 'right',
    navigateTo: '/operator',
    wait: 'none',
    role: 'operator'
  },
  {
    id: 'nav-shift',
    target: 'nav-shift',
    title: 'Moja zmiana',
    description: 'Kliknij "Moja zmiana" w menu żeby przejść do formularza startu zmiany.',
    waitDescription: 'Kliknij "Moja zmiana" w lewym menu...',
    position: 'right',
    navigateTo: '/operator',
    wait: 'none',
    role: 'operator'
  },
  {
    id: 'machine',
    target: 'shift-machine',
    title: 'Krok 1 — Wybierz maszynę',
    description: 'Kliknij maszynę przy której pracujesz — Automat 3 lub Automat 4.',
    waitDescription: 'Czekam aż wybierzesz maszynę...',
    position: 'bottom',
    navigateTo: '/operator/shift',
    wait: 'machine-selected',
    role: 'operator'
  },
  {
    id: 'shift-type',
    target: 'shift-type',
    title: 'Krok 2 — Wybierz zmianę',
    description: 'Wybierz swoją zmianę — I (06–14), II (14–22) lub III (22–06).',
    waitDescription: 'Czekam aż wybierzesz zmianę...',
    position: 'bottom',
    navigateTo: '/operator/shift',
    wait: 'shift-selected',
    role: 'operator'
  },
  {
    id: 'start-btn',
    target: 'shift-start-btn',
    title: 'Krok 3 — Rozpocznij zmianę',
    description: 'Kliknij "Rozpocznij zmianę". Zmiana zostanie zarejestrowana w systemie z aktualną godziną.',
    waitDescription: 'Czekam aż klikniesz "Rozpocznij zmianę"...',
    position: 'top',
    navigateTo: '/operator/shift',
    wait: 'shift-started',
    role: 'operator'
  },
  {
    id: 'nav-report',
    target: 'nav-report',
    title: 'Krok 4 — Wpisz wynik',
    description: 'Co godzinę klikasz tutaj i wpisujesz wyniki produkcji. System przypomni Ci alertem przed końcem godziny.',
    position: 'right',
    navigateTo: '/operator/shift',
    wait: 'none',
    role: 'operator'
  },
  {
    id: 'counter-good',
    target: 'report-counter-good',
    title: 'Krok 5 — Licznik dobrych sztuk',
    description: 'Wpisz aktualny stan licznika dobrych sztuk z wyświetlacza maszyny. System sam policzy przyrost od poprzedniego raportu.',
    waitDescription: 'Wpisz wartość licznika dobrych sztuk...',
    position: 'right',
    navigateTo: '/operator/report',
    wait: 'value-entered',
    role: 'operator'
  },
  {
    id: 'counter-times',
    target: 'report-counter-times',
    title: 'Krok 6 — Liczniki czasów',
    description: 'Wpisz stan liczników czasu pracy, gotowości i alarmu w formacie HH:MM. Suma przyrostów musi wynosić dokładnie 01:00.',
    position: 'top',
    navigateTo: '/operator/report',
    wait: 'none',
    role: 'operator'
  },
  {
    id: 'save-btn',
    target: 'report-save-btn',
    title: 'Krok 7 — Zapisz raport',
    description: 'Kliknij "Zapisz raport godzinowy". Dane trafią do systemu i będą widoczne dla kierownika na żywo.',
    waitDescription: 'Kliknij przycisk Zapisz raport...',
    position: 'top',
    navigateTo: '/operator/report',
    wait: 'report-saved',
    role: 'operator'
  },
  {
    id: 'order-mgmt',
    target: 'report-order-section',
    title: 'Krok 8 — Zarządzanie zleceniem',
    description: 'Tu widzisz aktywne zlecenie. Możesz je ⏸ zapauzować (np. przy zmianie asortymentu), ▶ wznowić lub 🏁 zakończyć gdy zlecenie jest wykonane.',
    position: 'bottom',
    navigateTo: '/operator/report',
    wait: 'none',
    role: 'operator'
  },
  {
    id: 'end-shift',
    target: 'shift-end-btn',
    title: 'Krok 9 — Zakończ zmianę',
    description: 'Po zakończeniu pracy kliknij "Zakończ zmianę". System sprawdzi czy wpisałeś raporty za wszystkie godziny zmiany.',
    position: 'top',
    navigateTo: '/operator/shift',
    wait: 'none',
    role: 'operator'
  },
]

// ─── Manager steps ────────────────────────────────────────────────────────────

const MANAGER_STEPS: TutorialStep[] = [
  {
    id: 'mgr-sidebar',
    target: 'sidebar-nav',
    title: 'Nawigacja kierownika',
    description: 'Masz dostęp do podglądu live produkcji, zleceń, asortymentu i eksportu raportów.',
    position: 'right',
    navigateTo: '/manager',
    wait: 'none',
    role: 'manager'
  },
  {
    id: 'mgr-kpi',
    target: 'manager-kpi',
    title: 'KPI na żywo',
    description: 'Tu widzisz produkcję wszystkich maszyn w bieżącej zmianie — łączna produkcja, efektywność, odrzuty i aktywne zmiany.',
    position: 'bottom',
    navigateTo: '/manager',
    wait: 'none',
    role: 'manager'
  },
  {
    id: 'mgr-machines',
    target: 'manager-machines',
    title: 'Podgląd maszyn',
    description: 'Każda karta pokazuje aktualny stan maszyny — operator, zmiana, produkcja tej godziny i efektywność. Czerwony = poniżej targetu.',
    position: 'top',
    navigateTo: '/manager',
    wait: 'none',
    role: 'manager'
  },
  {
    id: 'mgr-alerts',
    target: 'manager-alerts',
    title: 'Alerty produkcyjne',
    description: 'System automatycznie generuje alerty gdy maszyna spada poniżej targetu lub operator nie wpisał raportu w czasie. Alerty możesz też otrzymywać na Teams.',
    position: 'top',
    navigateTo: '/manager',
    wait: 'none',
    role: 'manager'
  },
]

// ─── Context ──────────────────────────────────────────────────────────────────

interface TutorialContextType {
  isActive: boolean
  currentStep: number
  totalSteps: number
  step: TutorialStep | null
  isWaiting: boolean
  startTutorial: () => void
  nextStep: () => void
  prevStep: () => void
  skipTutorial: () => void
  // Wywoływane przez komponenty gdy warunek jest spełniony
  notifyCondition: (condition: WaitCondition) => void
}

const TutorialContext = createContext<TutorialContextType | null>(null)

export function useTutorial() {
  const ctx = useContext(TutorialContext)
  if (!ctx) throw new Error('useTutorial must be used inside TutorialProvider')
  return ctx
}

const TUTORIAL_KEY = 'margoprod-tutorial-v2'

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuthStore()
  const { activeShift } = useShiftStore()
  const navigate = useNavigate()

  const [isActive, setIsActive]       = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isWaiting, setIsWaiting]     = useState(false)
  const pendingCondition              = useRef<WaitCondition>('none')

  const steps = profile?.role === 'manager' ? MANAGER_STEPS : OPERATOR_STEPS

  const step = isActive ? (steps[currentStep] ?? null) : null

  // Nawiguj przy zmianie kroku
  useEffect(() => {
    if (!isActive || !step?.navigateTo) return
    navigate(step.navigateTo)
  }, [isActive, currentStep]) // eslint-disable-line

  // Ustaw waiting gdy krok ma warunek
  useEffect(() => {
    if (!isActive || !step) return
    if (step.wait && step.wait !== 'none') {
      setIsWaiting(true)
      pendingCondition.current = step.wait
    } else {
      setIsWaiting(false)
      pendingCondition.current = 'none'
    }
  }, [isActive, currentStep]) // eslint-disable-line

  // Auto-start przy pierwszym logowaniu
  useEffect(() => {
    if (!profile) return
    if (profile.role === 'admin') return
    const key = `${TUTORIAL_KEY}-${profile.id}`
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => { setCurrentStep(0); setIsActive(true) }, 1200)
      return () => clearTimeout(t)
    }
  }, [profile])

  const advance = useCallback(() => {
    setIsWaiting(false)
    pendingCondition.current = 'none'
    setCurrentStep(s => {
      const next = s + 1
      if (next >= steps.length) {
        setIsActive(false)
        if (profile?.id) localStorage.setItem(`${TUTORIAL_KEY}-${profile.id}`, '1')
        return 0
      }
      return next
    })
  }, [steps.length, profile?.id])

  // Wywoływane przez komponenty (Shift, Report) gdy akcja się wykonała
  const notifyCondition = useCallback((condition: WaitCondition) => {
    if (pendingCondition.current === condition) {
      // Krótkie opóźnienie żeby UI zdążyło się zaktualizować
      setTimeout(advance, 400)
    }
  }, [advance])

  const startTutorial = useCallback(() => {
    setCurrentStep(0)
    setIsWaiting(false)
    setIsActive(true)
  }, [])

  const nextStep = useCallback(() => {
    if (isWaiting) return // nie można przeskoczyć kroku z warunkiem
    advance()
  }, [isWaiting, advance])

  const prevStep = useCallback(() => {
    if (currentStep === 0) return
    setIsWaiting(false)
    pendingCondition.current = 'none'
    setCurrentStep(s => s - 1)
  }, [currentStep])

  const skipTutorial = useCallback(() => {
    if (!window.confirm('Czy na pewno chcesz pominąć samouczek?\n\nMożesz go uruchomić ponownie przyciskiem 🎓 w menu.')) return
    setIsActive(false)
    setIsWaiting(false)
    setCurrentStep(0)
    pendingCondition.current = 'none'
    if (profile?.id) localStorage.setItem(`${TUTORIAL_KEY}-${profile.id}`, '1')
  }, [profile?.id])

  return (
    <TutorialContext.Provider value={{
      isActive,
      currentStep,
      totalSteps: steps.length,
      step,
      isWaiting,
      startTutorial,
      nextStep,
      prevStep,
      skipTutorial,
      notifyCondition
    }}>
      {children}
    </TutorialContext.Provider>
  )
}
