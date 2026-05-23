import { useEffect, useState } from 'react'

interface Props { onComplete?: () => void }

export default function LoadingScreen({ onComplete }: Props) {
  const [phase, setPhase] = useState(0)
  // 0=pulse, 1=burst, 2=fade, 3=done

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1400)
    const t2 = setTimeout(() => setPhase(2), 2000)
    const t3 = setTimeout(() => {
      setPhase(3)
      onComplete?.()
    }, 2600)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, []) // eslint-disable-line

  if (phase === 3) return null

  const isBurst = phase === 1
  const isFade  = phase === 2

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:'#07080D',
      display:'flex', alignItems:'center', justifyContent:'center',
      opacity: isFade ? 0 : 1,
      transition: isFade ? 'opacity 0.6s ease-out' : 'none',
      pointerEvents: isFade ? 'none' : 'all'
    }}>
      <style>{`
        @keyframes ml-glow-pulse {
          0%,100% { opacity:.35; transform:scale(1); }
          50%      { opacity:.8;  transform:scale(1.5); }
        }
        @keyframes ml-logo-float {
          0%,100% { transform:translateY(0) scale(1); }
          50%      { transform:translateY(-7px) scale(1.03); }
        }
        @keyframes ml-ring-out {
          0%   { transform:scale(.6); opacity:.9; }
          100% { transform:scale(8);  opacity:0; }
        }
        @keyframes ml-spark-fly {
          0%   { opacity:1; transform:translate(0,0) scale(1); }
          100% { opacity:0; transform:var(--tx) scale(0); }
        }
        @keyframes ml-dot-pulse {
          0%,100% { opacity:.25; transform:scale(.8); }
          50%      { opacity:1;   transform:scale(1.2); }
        }
        @keyframes ml-logo-burst {
          0%  { transform:scale(1); }
          35% { transform:scale(1.18); }
          70% { transform:scale(.97); }
          100%{ transform:scale(1); }
        }
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position:'absolute', width:280, height:280, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(201,168,76,.14) 0%, transparent 70%)',
        filter:'blur(35px)',
        animation: isBurst ? 'none' : 'ml-glow-pulse 2.5s ease-in-out infinite',
        opacity: isBurst ? 0 : undefined,
        transform: isBurst ? 'scale(5)' : undefined,
        transition: isBurst ? 'opacity .5s, transform .5s' : 'none'
      }}/>

      {/* Burst rings — softer */}
      {isBurst && [0,1,2].map(i => (
        <div key={i} style={{
          position:'absolute', width:88, height:88, borderRadius:'50%',
          border:`${2-i*0.5}px solid rgba(201,168,76,${.6 - i*.15})`,
          animation:`ml-ring-out ${.55 + i*.15}s cubic-bezier(.2,.8,.3,1) forwards`,
          animationDelay:`${i*.06}s`,
          boxShadow:`0 0 ${12-i*3}px rgba(201,168,76,.4)`
        }}/>
      ))}

      {/* Sparks — fewer, softer */}
      {isBurst && [
        {tx:'translate(-110px,-70px)'},{tx:'translate(115px,-75px)'},
        {tx:'translate(-95px,95px)'}, {tx:'translate(100px,90px)'},
        {tx:'translate(0,-130px)'},   {tx:'translate(0,120px)'},
      ].map((s,i) => (
        <div key={i} style={{
          position:'absolute', width:5, height:5, borderRadius:'50%',
          background:'#c9a84c',
          boxShadow:'0 0 6px rgba(201,168,76,.8)',
          '--tx': s.tx,
          animation:`ml-spark-fly .55s cubic-bezier(.2,.8,.3,1) forwards`,
          animationDelay:`${i*.04}s`
        } as React.CSSProperties}/>
      ))}

      {/* Soft flash — much gentler */}
      {isBurst && (
        <div style={{
          position:'absolute', inset:0, pointerEvents:'none',
          background:'radial-gradient(ellipse at center, rgba(201,168,76,.22) 0%, rgba(201,168,76,.06) 40%, transparent 65%)',
          animation:'ml-ring-out .9s ease-out forwards'
        }}/>
      )}

      {/* Logo */}
      <div style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'center', gap:18 }}>
        <div style={{
          width:88, height:88, borderRadius:20,
          background:'linear-gradient(135deg,#0D0E16,#111320)',
          border:`1.5px solid rgba(201,168,76,${isBurst ? .9 : .4})`,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: isBurst
            ? '0 0 50px rgba(201,168,76,.6), 0 0 100px rgba(201,168,76,.25), inset 0 0 20px rgba(201,168,76,.08)'
            : '0 0 20px rgba(201,168,76,.15), inset 0 0 8px rgba(201,168,76,.04)',
          animation: isBurst ? 'ml-logo-burst .6s ease-out' : 'ml-logo-float 3s ease-in-out infinite',
          transition:'box-shadow .3s, border-color .3s'
        }}>
          <svg width="50" height="50" viewBox="0 0 44 44" fill="none">
            <path d="M22 3 L39 12.5 L39 31.5 L22 41 L5 31.5 L5 12.5 Z"
              stroke="#c9a84c" strokeWidth="1.5" fill="none"
              style={{ filter: isBurst ? 'drop-shadow(0 0 6px rgba(201,168,76,.7))' : 'none', transition:'filter .3s' }}/>
            <path d="M22 3 L22 41 M5 12.5 L39 31.5 M39 12.5 L5 31.5"
              stroke="#c9a84c" strokeWidth=".75" opacity=".25"/>
            <circle cx="22" cy="22" r="4.5" fill="#c9a84c"
              style={{ filter: isBurst ? 'drop-shadow(0 0 8px rgba(201,168,76,.9))' : 'drop-shadow(0 0 3px rgba(201,168,76,.5))', transition:'filter .3s' }}/>
          </svg>
        </div>

        <div style={{ textAlign:'center' }}>
          <div style={{
            fontSize:24, fontWeight:800, color:'#fff',
            letterSpacing:'.07em', fontFamily:'system-ui,sans-serif',
            textShadow: isBurst ? '0 0 30px rgba(201,168,76,.7)' : 'none',
            transition:'text-shadow .3s'
          }}>MargoLine</div>
          <div style={{
            fontSize:11, color:'#c9a84c', letterSpacing:'.16em',
            marginTop:4, fontFamily:'system-ui,sans-serif', opacity:.75
          }}>MES v1.0</div>
        </div>

        {phase === 0 && (
          <div style={{ display:'flex', gap:6, marginTop:2 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width:5, height:5, borderRadius:'50%', background:'#c9a84c',
                animation:`ml-dot-pulse 1.4s ease-in-out infinite`,
                animationDelay:`${i*.22}s`
              }}/>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
