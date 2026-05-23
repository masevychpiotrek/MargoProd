import { useEffect, useState } from 'react'

export function useCountUp(target: number, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target === 0) { setValue(0); return }
    let frame: number
    const startTime = performance.now() + delay

    const animate = (now: number) => {
      if (now < startTime) { frame = requestAnimationFrame(animate); return }
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.round(eased * target))
      if (progress < 1) frame = requestAnimationFrame(animate)
    }

    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, delay])

  return value
}
