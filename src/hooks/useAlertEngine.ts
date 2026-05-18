import { useEffect, useRef, useCallback } from 'react'
import { useClock } from './useClock'
import { useShiftStore } from '@/stores/shiftStore'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// Alert thresholds in seconds before hour end
const ALERT_THRESHOLDS = [120, 60, 0] // 2 min, 1 min, on the hour

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
      // Aggressive beeping for overdue
      oscillator.frequency.setValueAtTime(880, ctx.currentTime)
      oscillator.frequency.setValueAtTime(440, ctx.currentTime + 0.1)
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.2)
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.4)
    } else {
      // Gentle ping
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
  const lastAlertMinute = useRef<number>(-1)
  const lastCheckedHour = useRef<number>(-1)
  const isReportedRef = useRef<Record<number, boolean>>({})
  const overdueInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check if current hour is reported
  const checkIfReported = useCallback(async (h: number) => {
    if (!activeShift || isReportedRef.current[h] !== undefined) return
    const { data } = await supabase
      .from('hourly_reports')
      .select('id')
      .eq('shift_id', activeShift.id)
      .eq('hour_start', h)
      .is('deleted_at', null)
      .maybeSingle()
    isReportedRef.current[h] = !!data
    if (data) {
      onHidePopup()
      if (overdueInterval.current) {
        clearInterval(overdueInterval.current)
        overdueInterval.current = null
      }
    }
  }, [activeShift, onHidePopup])

  // Reset reported cache when hour changes
  useEffect(() => {
    if (hour !== lastCheckedHour.current) {
      lastCheckedHour.current = hour
      // Keep last 3 hours in cache, reset rest
      const newCache: Record<number, boolean> = {}
      for (let i = 0; i < 3; i++) {
        const h = (hour - i + 24) % 24
        if (isReportedRef.current[h] !== undefined) {
          newCache[h] = isReportedRef.current[h]
        }
      }
      isReportedRef.current = newCache
    }
  }, [hour])

  useEffect(() => {
    if (!activeShift) return

    // Alert at 58:00 left (2 min before), 59:00 left (1 min before), 59:59 (on the hour)
    const minutesLeft = 59 - minute

    if (minutesLeft <= 2 && minutesLeft !== lastAlertMinute.current) {
      lastAlertMinute.current = minutesLeft

      checkIfReported(hour).then(() => {
        if (isReportedRef.current[hour]) return

        if (minutesLeft === 2) {
          playAlertSound(false)
          sendBrowserNotification(
            '⏰ Za 2 minuty koniec godziny',
            `Wpisz wynik za godzinę ${String(hour).padStart(2,'0')}:00–${String((hour+1)%24).padStart(2,'0')}:00`,
            false
          )
        } else if (minutesLeft === 1) {
          playAlertSound(false)
          sendBrowserNotification(
            '⚠ Za 1 minutę koniec godziny!',
            `Jeszcze nie wpisałeś wyniku za tę godzinę!`,
            false
          )
        } else if (minutesLeft === 0 && second >= 58) {
          playAlertSound(true)
          sendBrowserNotification(
            '🚨 CZAS NA WPIS WYNIKÓW!',
            `Godzina ${String(hour).padStart(2,'0')}:00 minęła — wpisz wynik natychmiast!`,
            true
          )
          onShowPopup(hour)

          // Start overdue interval - sound every 60s until reported
          if (!overdueInterval.current) {
            overdueInterval.current = setInterval(async () => {
              await checkIfReported(hour)
              if (!isReportedRef.current[hour]) {
                playAlertSound(true)
              } else {
                if (overdueInterval.current) clearInterval(overdueInterval.current)
                overdueInterval.current = null
                onHidePopup()
              }
            }, 60_000)
          }
        }
      })
    }

    return () => {}
  }, [minute, second, hour, activeShift, checkIfReported, onShowPopup, onHidePopup])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (overdueInterval.current) clearInterval(overdueInterval.current)
    }
  }, [])

  // Mark as reported (called externally after saving)
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
