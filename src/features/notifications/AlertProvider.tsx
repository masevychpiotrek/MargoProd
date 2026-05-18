import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertPopup, NotificationBanner } from '@/components/shared/AlertPopup'
import { useAlertEngine, requestNotificationPermission } from '@/hooks/useAlertEngine'
import { useShiftStore } from '@/stores/shiftStore'

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { activeShift } = useShiftStore()
  const [popupHour, setPopupHour] = useState<number | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Show notification permission banner after 5s if not granted
  useEffect(() => {
    if (bannerDismissed) return
    const timer = setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'default') {
        setShowBanner(true)
      }
    }, 5000)
    return () => clearTimeout(timer)
  }, [bannerDismissed])

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
      {popupHour !== null && activeShift && (
        <AlertPopup
          hour={popupHour}
          onDismiss={() => setPopupHour(null)}
          onGoToReport={handleGoToReport}
        />
      )}

      {/* Notification permission banner */}
      {showBanner && (
        <NotificationBanner
          onAllow={handleAllowNotifications}
          onDismiss={() => { setShowBanner(false); setBannerDismissed(true) }}
        />
      )}
    </>
  )
}
