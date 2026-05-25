import { useEffect, useRef, useCallback } from 'react'
import { useClock } from './useClock'
import { useShiftStore } from '@/stores/shiftStore'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useTestMode } from './useTestMode'

// TRYB TESTOWY — alert co minutę zamiast co godzinę
const SHIFT_HOURS: Record<string, number[]> = {
  I:   [6,7,8,9,10,11,12,13],
  II:  [14,15,16,17,18,19,20,21],
  III: [22,23,0,1,2,3,4,5]
}

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
  const testMode = useTestMode()
  const { now, hour, minute, second } = useClock()
  const { activeShift } = useShiftStore()
  const { profile } = useAuthStore()
  const lastAlertRef = useRef<number>(-1)
  const lastCheckedRef = useRef<number>(-1)
  const isReportedRef = useRef<Record<number, boolean>>({})
  const overdueInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // W trybie testowym "godzina raportu" = minuta bieżąca
  const reportKey = testMode ? Math.floor(now.getMinutes() / 3) : hour

  const checkIfReported = useCallback(async (key: number) => {
    if (profile?.role !== 'operator' || !activeShift || isReportedRef.current[key] !== undefined) return
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
  }, [activeShift, profile?.role, onHidePopup])

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
    const assignedToShift = !!activeShift && profile?.role === 'operator' &&
      (activeShift.operator_1_id === profile.id || activeShift.operator_2_id === profile.id)

    if (!assignedToShift) {
      onHidePopup()
      if (overdueInterval.current) {
        clearInterval(overdueInterval.current)
        overdueInterval.current = null
      }
      return
    }

    const shiftHours = SHIFT_HOURS[activeShift.shift_type] ?? []
    if (!testMode && !shiftHours.includes(hour)) {
      onHidePopup()
      if (overdueInterval.current) {
        clearInterval(overdueInterval.current)
        overdueInterval.current = null
      }
      return
    }

    if (testMode) {
      // Ile sekund zostało do końca bloku 3-minutowego
      const blockStart = Math.floor(now.getMinutes() / 3) * 3
      const endOfBlock = new Date(now)
      endOfBlock.setMinutes(blockStart + 3, 0, 0)
      const secsLeft = Math.max(0, Math.floor((endOfBlock.getTime() - now.getTime()) / 1000))

      if (secsLeft <= 20 && secsLeft !== lastAlertRef.current) {
        lastAlertRef.current = secsLeft

        checkIfReported(reportKey).then(() => {
          if (isReportedRef.current[reportKey]) return

          if (secsLeft === 20) {
            playAlertSound(false)
            const blockLabel = `${String(blockStart).padStart(2,'0')}–${String(blockStart+3).padStart(2,'0')}`
            sendBrowserNotification('⏰ Za 20 sekund koniec bloku', `Wpisz wynik za blok ${blockLabel}`, false)
          } else if (secsLeft <= 2) {
            playAlertSound(true)
            sendBrowserNotification('🚨 CZAS NA WPIS!', `Blok 3-minutowy minął!`, true)
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
              }, 15_000)
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
  }, [minute, second, hour, now, activeShift, profile?.id, profile?.role, checkIfReported, onShowPopup, onHidePopup, reportKey, testMode])

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
