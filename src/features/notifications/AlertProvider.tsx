import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertPopup, NotificationBanner } from '@/components/shared/AlertPopup'
import { useAlertEngine, requestNotificationPermission } from '@/hooks/useAlertEngine'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { activeShift } = useShiftStore()
  const { profile } = useAuthStore()
  const [popupHour, setPopupHour] = useState<number | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const alertsEnabled = profile?.role === 'operator' && !!activeShift &&
    (activeShift.operator_1_id === profile.id || activeShift.operator_2_id === profile.id)

  // Show notification permission banner after 5s if not granted
  useEffect(() => {
    if (!alertsEnabled) {
      setShowBanner(false)
      return
    }
    if (bannerDismissed) return
    const timer = setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'default') {
        setShowBanner(true)
      }
    }, 5000)
    return () => clearTimeout(timer)
  }, [alertsEnabled, bannerDismissed])

  useEffect(() => {
    if (!alertsEnabled) setPopupHour(null)
  }, [alertsEnabled])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('margoprod:report-overdue', {
      detail: { active: alertsEnabled && popupHour !== null, hour: popupHour }
    }))
  }, [alertsEnabled, popupHour])

  const handleShowPopup = useCallback((hour: number) => {
    setPopupHour(hour)
  }, [])

  const handleHidePopup = useCallback(() => {
    setPopupHour(null)
  }, [])

  useAlertEngine(handleShowPopup, handleHidePopup)

  const handleGoToReport = () => {
    setPopupHour(null)
    navigate('/operator/report')
  }

  const handleAllowNotifications = () => {
    requestNotificationPermission()
    setShowBanner(false)
    setBannerDismissed(true)
  }

  return (
    <>
      {children}

      {/* Fullscreen alert popup */}
      {alertsEnabled && popupHour !== null && (
        <AlertPopup
          hour={popupHour}
          onDismiss={() => setPopupHour(null)}
          onGoToReport={handleGoToReport}
        />
      )}

      {/* Notification permission banner */}
      {alertsEnabled && showBanner && (
        <NotificationBanner
          onAllow={handleAllowNotifications}
          onDismiss={() => { setShowBanner(false); setBannerDismissed(true) }}
        />
      )}
    </>
  )
}
