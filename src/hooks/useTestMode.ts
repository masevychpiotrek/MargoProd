import { useEffect, useState } from 'react'

const TEST_MODE_KEY = 'margoline-test-mode'
const TEST_MODE_EVENT = 'margoline-test-mode-change'

export function isTestModeEnabled() {
  return localStorage.getItem(TEST_MODE_KEY) === '1'
}

export function setTestModeEnabled(enabled: boolean) {
  localStorage.setItem(TEST_MODE_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new Event(TEST_MODE_EVENT))
}

export function useTestMode() {
  const [enabled, setEnabled] = useState(isTestModeEnabled)

  useEffect(() => {
    const sync = () => setEnabled(isTestModeEnabled())
    window.addEventListener('storage', sync)
    window.addEventListener(TEST_MODE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(TEST_MODE_EVENT, sync)
    }
  }, [])

  return enabled
}
