import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  pct: number
  color?: string
  delay?: number
  height?: string
}

export function AnimatedBar({ pct, color = 'bg-brand', delay = 0, height = 'h-2' }: Props) {
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => setWidth(Math.min(pct, 100)), delay)
        observer.disconnect()
      }
    })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [pct, delay])

  return (
    <div ref={ref} className={cn('bg-navy-700 rounded-full overflow-hidden w-full', height)}>
      <div
        className={cn('h-full rounded-full', color)}
        style={{ width: `${width}%`, transition: 'width 1s cubic-bezier(0.22,1,0.36,1)' }}
      />
    </div>
  )
}
