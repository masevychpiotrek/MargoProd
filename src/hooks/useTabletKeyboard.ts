import { useEffect } from 'react'

export function useTabletKeyboard() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    const touch = window.matchMedia('(any-pointer: coarse)')
    let timer = 0
    let blurTimer = 0
    const update = () => {
      window.clearTimeout(timer)
      const field = document.activeElement
      const editing = touch.matches && field instanceof HTMLElement &&
        field.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), [contenteditable="true"]')
      root.toggleAttribute('data-touch-editing', editing)
      const inset = editing ? Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0)) : 0
      root.style.setProperty('--keyboard-inset', `${inset}px`)
      if (!editing || (viewport && viewport.scale > 1.05)) return
      timer = window.setTimeout(() => {
        if (document.activeElement !== field) return
        const top = (viewport?.offsetTop ?? 0) + 12
        const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 16
        // Keep the entire entry row (including Save) visible when there is room.
        const row = field.closest<HTMLElement>('[data-input-context]') ?? field
        const target = row.getBoundingClientRect().height <= bottom - top ? row : field
        const rect = target.getBoundingClientRect()
        if (rect.top < top || rect.bottom > bottom) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' })
          const after = target.getBoundingClientRect()
          if (after.bottom > bottom) window.scrollBy(0, after.bottom - bottom)
          else if (after.top < top) window.scrollBy(0, after.top - top)
        }
      }, 120)
    }
    const focusIn = () => { window.clearTimeout(blurTimer); update() }
    // Let a tap on Save finish before restoring the toolbar moves the form.
    const focusOut = () => { blurTimer = window.setTimeout(update, 250) }
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(blurTimer)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      root.removeAttribute('data-touch-editing')
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}
