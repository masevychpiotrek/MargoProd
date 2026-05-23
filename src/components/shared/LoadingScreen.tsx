import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  onComplete?: () => void
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [phase, setPhase] = useState<'pulse' | 'burst' | 'fade'>('pulse')

  useEffect(() => {
    // After 1.2s pulse, trigger burst
    const t1 = setTimeout(() => setPhase('burst'), 1200)
    // After burst, fade out
    const t2 = setTimeout(() => setPhase('fade'), 1800)
    // After fade, call onComplete
    const t3 = setTimeout(() => onComplete?.(), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onComplete])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: '#07080D',
        zIndex: 9999,
        opacity: phase === 'fade' ? 0 : 1,
        transition: phase === 'fade' ? 'opacity 0.6s ease-out' : 'none',
        pointerEvents: phase === 'fade' ? 'none' : 'all'
      }}
    >
      {/* Burst rings */}
      {phase === 'burst' && (
        <>
          {[1,2,3,4].map(i => (
            <div key={i} style={{
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: '50%',
              border: `${5 - i}px solid rgba(201,168,76,${0.8 - i * 0.15})`,
              animation: `burst-ring ${0.6 + i * 0.1}s ease-out forwards`,
              animationDelay: `${i * 0.05}s`
            }} />
          ))}
          {/* Gold flash overlay */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.35) 0%, rgba(201,168,76,0.05) 50%, transparent 70%)',
            animation: 'flash-fade 0.8s ease-out forwards'
          }} />
        </>
      )}

      {/* Ambient glow behind logo */}
      <div style={{
        position: 'absolute',
        width: 200,
        height: 200,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(201,168,76,0.15) 0%, transparent 70%)',
        animation: phase === 'burst'
          ? 'glow-burst 0.8s ease-out forwards'
          : 'glow-pulse 2s ease-in-out infinite',
        filter: 'blur(20px)'
      }} />

      {/* Logo container */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20
      }}>
        {/* Hexagon logo */}
        <div style={{
          width: 80,
          height: 80,
          borderRadius: 18,
          background: '#0D0E16',
          border: '1.5px solid rgba(201,168,76,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: phase === 'burst'
            ? '0 0 60px rgba(201,168,76,0.8), 0 0 120px rgba(201,168,76,0.4), inset 0 0 30px rgba(201,168,76,0.1)'
            : '0 0 20px rgba(201,168,76,0.2), inset 0 0 10px rgba(201,168,76,0.05)',
          animation: phase === 'burst' ? 'logo-burst 0.6s ease-out forwards' : 'logo-pulse 2s ease-in-out infinite',
          transition: 'box-shadow 0.3s ease'
        }}>
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            {/* Hexagon */}
            <path
              d="M22 4 L38 13 L38 31 L22 40 L6 31 L6 13 Z"
              stroke="#c9a84c"
              strokeWidth="1.5"
              fill="none"
              style={{
                filter: phase === 'burst' ? 'drop-shadow(0 0 6px #c9a84c)' : 'none',
                transition: 'filter 0.3s'
              }}
            />
            {/* Inner lines */}
            <path d="M22 4 L22 40" stroke="#c9a84c" strokeWidth="0.75" opacity="0.3"/>
            <path d="M6 13 L38 31" stroke="#c9a84c" strokeWidth="0.75" opacity="0.3"/>
            <path d="M38 13 L6 31" stroke="#c9a84c" strokeWidth="0.75" opacity="0.3"/>
            {/* Center dot */}
            <circle
              cx="22"
              cy="22"
              r="4"
              fill="#c9a84c"
              style={{
                filter: phase === 'burst' ? 'drop-shadow(0 0 8px #c9a84c)' : 'none',
                transition: 'filter 0.3s'
              }}
            />
          </svg>
        </div>

        {/* Text */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '0.05em',
            fontFamily: 'system-ui, sans-serif',
            opacity: phase === 'burst' ? 1 : 0.9,
            textShadow: phase === 'burst' ? '0 0 20px rgba(201,168,76,0.6)' : 'none',
            transition: 'text-shadow 0.3s'
          }}>
            MargoProd
          </div>
          <div style={{
            fontSize: 11,
            color: '#c9a84c',
            letterSpacing: '0.15em',
            marginTop: 4,
            fontFamily: 'system-ui, sans-serif'
          }}>
            MES v1.0
          </div>
        </div>

        {/* Loading dots */}
        {phase === 'pulse' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#c9a84c',
                opacity: 0.4,
                animation: `dot-pulse 1.2s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`
              }} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.3); opacity: 1; }
        }
        @keyframes glow-burst {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(8); opacity: 0; }
        }
        @keyframes logo-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @keyframes logo-burst {
          0% { transform: scale(1); }
          40% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        @keyframes burst-ring {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(6); opacity: 0; }
        }
        @keyframes flash-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
