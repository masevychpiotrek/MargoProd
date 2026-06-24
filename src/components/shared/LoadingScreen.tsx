import { useEffect, useRef } from 'react'

interface LoadingScreenProps {
  onLogin?: () => void
  autoExitMs?: number
}

export default function LoadingScreen({ onLogin, autoExitMs }: LoadingScreenProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onLoginRef = useRef(onLogin)

  useEffect(() => {
    onLoginRef.current = onLogin
  }, [onLogin])

  useEffect(() => {
    if (!autoExitMs) return undefined
    const timer = window.setTimeout(() => onLoginRef.current?.(), autoExitMs)
    return () => window.clearTimeout(timer)
  }, [autoExitMs])

  useEffect(() => {
    let disposed = false
    let cleanupClick: (() => void) | undefined

    const bindEnterButton = () => {
      if (disposed) return

      const frameWindow = iframeRef.current?.contentWindow
      const frameDocument = iframeRef.current?.contentDocument
      if (!frameWindow || !frameDocument?.body) return

      ;(frameWindow as typeof frameWindow & { __mlOnLogin?: () => void }).__mlOnLogin = () => {
        onLoginRef.current?.()
      }

      cleanupClick?.()
      const handleClick = (event: MouseEvent) => {
        const target = event.target as Element | null
        if (!target) return
        if (!target.closest('#enterBtn')) return

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        onLoginRef.current?.()
      }

      frameDocument.addEventListener('click', handleClick, true)
      cleanupClick = () => frameDocument.removeEventListener('click', handleClick, true)
    }

    const interval = window.setInterval(bindEnterButton, 300)
    bindEnterButton()

    return () => {
      disposed = true
      cleanupClick?.()
      window.clearInterval(interval)
    }
  }, [])

  return (
    <iframe
      ref={iframeRef}
      title="MargoLine ekran powitalny"
      src="/margoline-welcome.html"
      className="fixed inset-0 h-screen w-screen border-0 bg-[#030507]"
      style={{ zIndex: 99999 }}
    />
  )
}
