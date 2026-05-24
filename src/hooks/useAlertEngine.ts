import { useEffect, useRef, useCallback } from 'react'
import { useClock } from './useClock'
import { useShiftStore } from '@/stores/shiftStore'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// TRYB TESTOWY — alert co minutę zamiast co godzinę
const TEST_MODE = localStorage.getItem('margoline-test-mode') === '1'

let audioCtx: AudioContext | null = null

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  return audioCtx
}

export function playAlertSound(urgent = false) {
  try {
    const ctx = getAudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    if (urgent) {
      oscillator.frequency.setValueAtTime(880, ctx.currentTime)
      oscillator.frequency.setValueAtTime(440, ctx.currentTime + 0.1)
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.2)
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.4)
    } else {
      oscillator.frequency.setValueAtTime(660, ctx.currentTime)
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.3)
    }
  } catch {}
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function sendBrowserNotification(title: string, body: string, urgent = false) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'margoprod-alert',
      requireInteraction: urgent,
      silent: false
    })
  }
}

export function useAlertEngine(
  onShowPopup: (hour: number) => void,
  onHidePopup: () => void
) {
  const { now, hour, minute, second } = useClock()
  const { activeShift } = useShiftStore()
  const { profile } = useAuthStore()
  const lastAlertRef = useRef<number>(-1)
  const lastCheckedRef = useRef<number>(-1)
  const isReportedRef = useRef<Record<number, boolean>>({})
  const overdueInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // W trybie testowym "godzina raportu" = minuta bieżąca
  const reportKey = TEST_MODE ? now.getMinutes() : hour

  const checkIfReported = useCallback(async (key: number) => {
    if (!activeShift || isReportedRef.current[key] !== undefined) return
    const { data } = await supabase
      .from('hourly_reports')
      .select('id')
      .eq('shift_id', activeShift.id)
      .eq('hour_start', key)
      .is('deleted_at', null)
      .maybeSingle()
    isReportedRef.current[key] = !!data
    if (data) {
      onHidePopup()
      if (overdueInterval.current) {
        clearInterval(overdueInterval.current)
        overdueInterval.current = null
      }
    }
  }, [activeShift, onHidePopup])

  useEffect(() => {
    if (reportKey !== lastCheckedRef.current) {
      lastCheckedRef.current = reportKey
      const newCache: Record<number, boolean> = {}
      for (let i = 0; i < 3; i++) {
        const k = (reportKey - i + 60) % 60
        if (isReportedRef.current[k] !== undefined) {
          newCache[k] = isReportedRef.current[k]
        }
      }
      isReportedRef.current = newCache
    }
  }, [reportKey])

  useEffect(() => {
    if (!activeShift) return

    if (TEST_MODE) {
      // Alert na ostatnie 10 sekund minuty
      const secsLeft = 59 - second

      if (secsLeft <= 10 && secsLeft !== lastAlertRef.current) {
        lastAlertRef.current = secsLeft

        checkIfReported(reportKey).then(() => {
          if (isReportedRef.current[reportKey]) return

          if (secsLeft === 10) {
            playAlertSound(false)
            sendBrowserNotification('⏰ Za 10 sekund koniec minuty', `Wpisz wynik za minutę ${String(now.getMinutes()).padStart(2,'0')}`, false)
          } else if (secsLeft === 0) {
            playAlertSound(true)
            sendBrowserNotification('🚨 CZAS NA WPIS!', `Minuta ${String(now.getMinutes()).padStart(2,'0')} minęła!`, true)
            onShowPopup(reportKey)

            if (!overdueInterval.current) {
              overdueInterval.current = setInterval(async () => {
                await checkIfReported(reportKey)
                if (!isReportedRef.current[reportKey]) {
                  playAlertSound(true)
                } else {
                  if (overdueInterval.current) clearInterval(overdueInterval.current)
                  overdueInterval.current = null
                  onHidePopup()
                }
              }, 10_000)
            }
          }
        })
      }
    } else {
      // Tryb produkcyjny — co godzinę
      const minutesLeft = 59 - minute
      if (minutesLeft <= 2 && minutesLeft !== lastAlertRef.current) {
        lastAlertRef.current = minutesLeft
        checkIfReported(hour).then(() => {
          if (isReportedRef.current[hour]) return
          if (minutesLeft === 2) {
            playAlertSound(false)
            sendBrowserNotification('⏰ Za 2 minuty koniec godziny', `Wpisz wynik za godzinę ${String(hour).padStart(2,'0')}:00–${String((hour+1)%24).padStart(2,'00')}:00`, false)
          } else if (minutesLeft === 1) {
            playAlertSound(false)
            sendBrowserNotification('⚠ Za 1 minutę koniec godziny!', `Jeszcze nie wpisałeś wyniku!`, false)
          } else if (minutesLeft === 0 && second >= 58) {
            playAlertSound(true)
            sendBrowserNotification('🚨 CZAS NA WPIS WYNIKÓW!', `Godzina minęła — wpisz wynik natychmiast!`, true)
            onShowPopup(hour)
            if (!overdueInterval.current) {
              overdueInterval.current = setInterval(async () => {
                await checkIfReported(hour)
                if (!isReportedRef.current[hour]) playAlertSound(true)
                else {
                  if (overdueInterval.current) clearInterval(overdueInterval.current)
                  overdueInterval.current = null
                  onHidePopup()
                }
              }, 60_000)
            }
          }
        })
      }
    }

    return () => {}
  }, [minute, second, hour, now, activeShift, checkIfReported, onShowPopup, onHidePopup, reportKey])

  useEffect(() => {
    return () => {
      if (overdueInterval.current) clearInterval(overdueInterval.current)
    }
  }, [])

  const markReported = useCallback((h: number) => {
    isReportedRef.current[h] = true
    onHidePopup()
    if (overdueInterval.current) {
      clearInterval(overdueInterval.current)
      overdueInterval.current = null
    }
  }, [onHidePopup])

  return { markReported }
}
