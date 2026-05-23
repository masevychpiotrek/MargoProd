import { useEffect, useState } from 'react'

interface Props { onComplete?: () => void }

export default function LoadingScreen({ onComplete }: Props) {
  const [phase, setPhase] = useState(0)
  // phase 0 = pulse, 1 = burst, 2 = fadeout, 3 = done

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1500)
    const t2 = setTimeout(() => setPhase(2), 2100)
    const t3 = setTimeout(() => { setPhase(3); onComplete?.() }, 2700)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  if (phase === 3) return null

  const isBurst = phase === 1
  const isFade  = phase === 2

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#07080D',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: isFade ? 0 : 1,
      transition: isFade ? 'opacity 0.6s ease-out' : 'none',
      pointerEvents: isFade ? 'none' : 'all'
    }}>
      <style>{`
        @keyframes ml-pulse-glow {
          0%,100% { opacity:.4; transform:scale(1); }
          50%      { opacity:1;  transform:scale(1.6); }
        }
        @keyframes ml-logo-float {
          0%,100% { transform:translateY(0) scale(1); }
          50%      { transform:translateY(-6px) scale(1.03); }
        }
        @keyframes ml-ring {
          0%   { transform:scale(.5); opacity:1; }
          100% { transform:scale(12); opacity:0; }
        }
        @keyframes ml-dot {
          0%,100% { opacity:.2; transform:scale(.8); }
          50%      { opacity:1;  transform:scale(1.2); }
        }
        @keyframes ml-burst-logo {
          0%  { transform:scale(1); }
          30% { transform:scale(1.25); }
          60% { transform:scale(.95); }
          100%{ transform:scale(1); }
        }
        @keyframes ml-text-glow {
          0%,100% { text-shadow: 0 0 10px rgba(201,168,76,.3); }
          50%      { text-shadow: 0 0 30px rgba(201,168,76,.9), 0 0 60px rgba(201,168,76,.4); }
        }
        @keyframes ml-spark {
          0%   { transform:translate(0,0) scale(1); opacity:1; }
          100% { transform:var(--tx) scale(0); opacity:0; }
        }
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position:'absolute', width:300, height:300, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(201,168,76,.18) 0%, transparent 70%)',
        filter:'blur(40px)',
        animation: isBurst ? 'none' : 'ml-pulse-glow 2s ease-in-out infinite',
        opacity: isBurst ? 0 : 1,
        transform: isBurst ? 'scale(6)' : 'scale(1)',
        transition: isBurst ? 'transform .5s ease-out, opacity .5s' : 'none'
      }}/>

      {/* Burst rings */}
      {isBurst && [0,1,2,3,4].map(i => (
        <div key={i} style={{
          position:'absolute', width:90, height:90, borderRadius:'50%',
          border:`${Math.max(1, 4-i)}px solid rgba(201,168,76,${.9 - i*.15})`,
          animation:`ml-ring ${.5 + i*.12}s cubic-bezier(.2,.8,.4,1) forwards`,
          animationDelay:`${i*.04}s`,
          boxShadow:`0 0 ${20-i*3}px rgba(201,168,76,.6)`
        }}/>
      ))}

      {/* Sparks */}
      {isBurst && [
        {tx:'translate(-120px,-80px)'},{tx:'translate(130px,-90px)'},
        {tx:'translate(-100px,100px)'},{tx:'translate(110px,90px)'},
        {tx:'translate(0,-140px)'},{tx:'translate(0,130px)'},
        {tx:'translate(-150px,10px)'},{tx:'translate(150px,-10px)'},
      ].map((s,i) => (
        <div key={i} style={{
          position:'absolute', width:6, height:6, borderRadius:'50%',
          background:'#c9a84c',
          boxShadow:'0 0 8px #c9a84c, 0 0 16px rgba(201,168,76,.6)',
          '--tx': s.tx,
          animation:`ml-spark .6s cubic-bezier(.2,.8,.4,1) forwards`,
          animationDelay:`${i*.03}s`
        } as React.CSSProperties}/>
      ))}

      {/* Flash overlay */}
      {isBurst && (
        <div style={{
          position:'absolute', inset:0,
          background:'radial-gradient(ellipse at center, rgba(201,168,76,.5) 0%, rgba(201,168,76,.15) 30%, transparent 65%)',
          animation:'ml-ring .7s ease-out forwards',
          pointerEvents:'none'
        }}/>
      )}

      {/* Logo box */}
      <div style={{
        position:'relative', display:'flex', flexDirection:'column',
        alignItems:'center', gap:20
      }}>
        <div style={{
          width:96, height:96, borderRadius:22,
          background:'linear-gradient(135deg,#0D0E16 0%,#111320 100%)',
          border:`1.5px solid rgba(201,168,76,${isBurst ? 1 : .4})`,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: isBurst
            ? '0 0 80px rgba(201,168,76,.9), 0 0 160px rgba(201,168,76,.5), 0 0 240px rgba(201,168,76,.2), inset 0 0 40px rgba(201,168,76,.15)'
            : '0 0 24px rgba(201,168,76,.2), inset 0 0 12px rgba(201,168,76,.05)',
          animation: isBurst ? 'ml-burst-logo .6s ease-out' : 'ml-logo-float 3s ease-in-out infinite',
          transition:'box-shadow .3s, border-color .3s'
        }}>
          <svg width="54" height="54" viewBox="0 0 44 44" fill="none">
            <path d="M22 3 L39 12.5 L39 31.5 L22 41 L5 31.5 L5 12.5 Z"
              stroke="#c9a84c" strokeWidth="1.5" fill="none"
              style={{ filter: isBurst ? 'drop-shadow(0 0 8px #c9a84c)' : 'none', transition:'filter .3s' }}/>
            <path d="M22 3 L22 41 M5 12.5 L39 31.5 M39 12.5 L5 31.5"
              stroke="#c9a84c" strokeWidth=".75" opacity=".3"/>
            <circle cx="22" cy="22" r="4.5" fill="#c9a84c"
              style={{ filter: isBurst ? 'drop-shadow(0 0 10px #c9a84c) drop-shadow(0 0 20px rgba(201,168,76,.7))' : 'drop-shadow(0 0 4px rgba(201,168,76,.5))', transition:'filter .3s' }}/>
          </svg>
        </div>

        <div style={{ textAlign:'center' }}>
          <div style={{
            fontSize:26, fontWeight:800, color:'#fff',
            letterSpacing:'.08em', fontFamily:'system-ui,sans-serif',
            animation: isBurst ? 'none' : 'ml-text-glow 3s ease-in-out infinite',
            textShadow: isBurst ? '0 0 40px rgba(201,168,76,1), 0 0 80px rgba(201,168,76,.6)' : undefined,
            transition:'text-shadow .3s'
          }}>MargoLine</div>
          <div style={{
            fontSize:11, color:'#c9a84c', letterSpacing:'.18em',
            marginTop:5, fontFamily:'system-ui,sans-serif', opacity:.8
          }}>MES v1.0</div>
        </div>

        {phase === 0 && (
          <div style={{ display:'flex', gap:7, marginTop:4 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width:5, height:5, borderRadius:'50%', background:'#c9a84c',
                animation:`ml-dot 1.4s ease-in-out infinite`,
                animationDelay:`${i*.22}s`
              }}/>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
