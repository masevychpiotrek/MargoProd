import { useEffect, useRef, useState } from 'react'

interface LoadingScreenProps {
  onLogin?: () => void
  autoExitMs?: number
}

const STYLES = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
canvas{position:fixed;inset:0;display:block;}
#ui{position:fixed;inset:0;pointer-events:none;}
#header{position:absolute;top:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding-top:4vh;gap:4px;}
.app-name{font-family:'Orbitron',sans-serif;font-size:clamp(1.6rem,5vw,2.6rem);font-weight:900;color:#D4A825;letter-spacing:.1em;text-shadow:0 0 40px rgba(212,168,37,.8),0 0 80px rgba(212,168,37,.3);opacity:0;transform:translateY(-18px);transition:opacity .8s,transform .8s;}
.app-name.show{opacity:1;transform:translateY(0);}
.name-row{display:flex;align-items:center;gap:10px;}
.badge{font-size:.65rem;font-weight:700;letter-spacing:.2em;color:#D4A825;border:1.5px solid #D4A825;border-radius:3px;padding:2px 6px;opacity:0;transition:opacity .5s .3s;}
.badge.show{opacity:1;}
.app-sub{font-size:clamp(.6rem,1.8vw,.82rem);color:rgba(232,223,200,.42);letter-spacing:.22em;text-transform:uppercase;opacity:0;transform:translateY(-8px);transition:opacity .6s .15s,transform .6s .15s;}
.app-sub.show{opacity:1;transform:translateY(0);}
#footer{position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding-bottom:52vh;gap:10px;}
.ready-wrap{display:flex;flex-direction:column;align-items:center;gap:9px;opacity:0;transition:opacity .7s;}
.ready-wrap.show{opacity:1;}
.ready-line{display:flex;align-items:center;gap:12px;}
.ready-dot{width:8px;height:8px;border-radius:50%;background:#00FF88;box-shadow:0 0 12px #00FF88,0 0 30px rgba(0,255,136,.5);animation:pdot 1.1s ease-in-out infinite;}
@keyframes pdot{0%,100%{transform:scale(1);}50%{transform:scale(1.5);opacity:.5;}}
.ready-text{font-family:'Orbitron',sans-serif;font-size:clamp(.8rem,2.5vw,1.05rem);font-weight:700;letter-spacing:.3em;color:#00FF88;text-shadow:0 0 18px rgba(0,255,136,.9),0 0 50px rgba(0,255,136,.35);}
.sbar-row{display:flex;align-items:center;gap:9px;}
.sbar{width:180px;height:2px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden;}
.sbar-fill{height:100%;width:0%;background:linear-gradient(90deg,#00aa55,#00FF88);border-radius:2px;transition:width .6s ease;box-shadow:0 0 8px rgba(0,255,136,.5);}
.sbar-txt{font-size:.6rem;letter-spacing:.16em;color:rgba(0,255,136,.5);text-transform:uppercase;}
.created{position:fixed;bottom:16px;left:0;right:0;text-align:center;font-family:'Orbitron',sans-serif;font-size:.62rem;letter-spacing:.3em;color:rgba(212,168,37,.55);text-transform:uppercase;opacity:0;transition:opacity 1.5s;}
.created.show{opacity:1;}
.created span{background:linear-gradient(90deg,rgba(212,168,37,.6),rgba(240,200,74,.95),rgba(212,168,37,.6));background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.5s linear infinite;}
@keyframes shimmer{to{background-position:200% center;}}
.corner{position:fixed;width:28px;height:28px;opacity:.3;}
.corner svg{width:100%;height:100%;}
.c-tl{top:14px;left:14px;}.c-tr{top:14px;right:14px;transform:scaleX(-1);}
.c-bl{bottom:14px;left:14px;transform:scaleY(-1);}.c-br{bottom:14px;right:14px;transform:scale(-1);}
#loginBtn{position:fixed;bottom:30vh;left:50%;transform:translateX(-50%) translateY(10px);pointer-events:all;cursor:pointer;background:rgba(212,168,37,.1);border:1.5px solid rgba(212,168,37,.6);color:#D4A825;font-family:'Orbitron',sans-serif;font-size:.75rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;padding:10px 28px;border-radius:4px;transition:background .25s,box-shadow .25s,opacity .6s,transform .6s;opacity:0;z-index:100;box-shadow:0 0 0 rgba(212,168,37,0);}
#loginBtn.show{opacity:1;transform:translateX(-50%) translateY(0);}
#loginBtn:hover{background:rgba(212,168,37,.22);box-shadow:0 0 22px rgba(212,168,37,.45);}
`

const HTML = `
  <canvas id="bg" style="position:fixed;inset:0;display:block;"></canvas>
  <canvas id="main" style="position:fixed;inset:0;display:block;"></canvas>
  <div id="ui" style="position:fixed;inset:0;pointer-events:none;">
    <div id="header" style="position:absolute;top:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding-top:4vh;gap:4px;">
      <div class="name-row" style="display:flex;align-items:center;gap:10px;">
        <div class="app-name" id="appName">MargoLine</div>
        <div class="badge" id="badge">BETA</div>
      </div>
      <div class="app-sub" id="appSub">System Monitorowania Produkcji</div>
    </div>
    <div id="footer" style="position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding-bottom:30vh;gap:10px;">
      <div class="ready-wrap" id="readyWrap">
        <div class="ready-line">
          <div class="ready-dot"></div>
          <div class="ready-text">SYSTEM GOTOWY</div>
          <div class="ready-dot"></div>
        </div>
        <div class="sbar-row">
          <div class="sbar"><div class="sbar-fill" id="sf"></div></div>
          <div class="sbar-txt">100%</div>
        </div>
      </div>
    </div>
    <div class="created" id="created">Created by <span>Masevych</span></div>
  </div>
  <div id="phaseLabel" style="position:fixed;top:8px;right:12px;font-size:.54rem;letter-spacing:.16em;color:rgba(212,168,37,.25);text-transform:uppercase;pointer-events:none;font-family:'Rajdhani',sans-serif;"></div>
  
  <div class="corner c-tl"><svg viewBox="0 0 28 28"><path d="M0 28L0 0L28 0" fill="none" stroke="#D4A825" stroke-width="1.8"/></svg></div>
  <div class="corner c-tr"><svg viewBox="0 0 28 28"><path d="M0 28L0 0L28 0" fill="none" stroke="#D4A825" stroke-width="1.8"/></svg></div>
  <div class="corner c-bl"><svg viewBox="0 0 28 28"><path d="M0 28L0 0L28 0" fill="none" stroke="#D4A825" stroke-width="1.8"/></svg></div>
  <div class="corner c-br"><svg viewBox="0 0 28 28"><path d="M0 28L0 0L28 0" fill="none" stroke="#D4A825" stroke-width="1.8"/></svg></div>
`

export default function LoadingScreen({ onLogin, autoExitMs }: LoadingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)

  // Animacja — odpala się tylko gdy started=true
  useEffect(() => {
    if (!started) return
    const container = containerRef.current
    if (!container) return

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;600;700&family=Orbitron:wght@400;700;900&display=swap'
    document.head.appendChild(link)

    const style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)

    container.innerHTML = HTML

    ;(window as any).__mlOnLogin = onLogin ?? null

    const script = document.createElement('script')
    script.src = '/loading-anim.js'
    script.async = true
    container.appendChild(script)

    let timer: ReturnType<typeof setTimeout> | null = null
    if (autoExitMs) {
      timer = setTimeout(() => { if (onLogin) onLogin() }, autoExitMs)
    }

    return () => {
      ;(window as any).__mlOnLogin = null
      if (timer) clearTimeout(timer)
      if (document.head.contains(style)) document.head.removeChild(style)
      if (document.head.contains(link)) document.head.removeChild(link)
    }
  }, [started, onLogin])

  // Ekran startowy przed animacją
  if (!started) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#080c10',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 99999
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&display=swap');
          @keyframes pulse-glow {
            0%,100% { box-shadow: 0 0 22px rgba(212,168,37,.25); }
            50% { box-shadow: 0 0 45px rgba(212,168,37,.6), 0 0 80px rgba(212,168,37,.2); }
          }
          @keyframes fade-in-up {
            from { opacity:0; transform:translateY(20px); }
            to { opacity:1; transform:translateY(0); }
          }
        `}</style>

        {/* Siatka w tle */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(212,168,37,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,37,.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }} />

        {/* Logo sześciokąt */}
        <svg width="72" height="72" viewBox="0 0 22 22" fill="none"
          style={{ marginBottom: '20px', animation: 'fade-in-up .8s ease forwards' }}>
          <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z"
            stroke="#c9a84c" strokeWidth="1.2" fill="none"/>
          <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15"
            stroke="#c9a84c" strokeWidth="0.5" opacity="0.25"/>
          <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
        </svg>

        {/* Nazwa */}
        <div style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 'clamp(1.8rem,5vw,2.8rem)',
          fontWeight: 900,
          color: '#D4A825',
          letterSpacing: '.1em',
          textShadow: '0 0 40px rgba(212,168,37,.7)',
          marginBottom: '6px',
          animation: 'fade-in-up .8s .1s ease both'
        }}>MargoLine</div>

        <div style={{
          fontSize: '.65rem',
          color: 'rgba(232,223,200,.35)',
          letterSpacing: '.25em',
          textTransform: 'uppercase',
          marginBottom: '52px',
          animation: 'fade-in-up .8s .2s ease both'
        }}>System Monitorowania Produkcji</div>

        {/* Przycisk */}
        <button
          onClick={() => setStarted(true)}
          style={{
            background: 'rgba(212,168,37,.08)',
            border: '1.5px solid rgba(212,168,37,.65)',
            color: '#D4A825',
            fontFamily: "'Orbitron', sans-serif",
            fontSize: '.78rem',
            fontWeight: 700,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            padding: '14px 40px',
            borderRadius: '4px',
            cursor: 'pointer',
            animation: 'fade-in-up .8s .4s ease both, pulse-glow 2.2s 1.2s ease-in-out infinite',
          }}
        >
          ▶ URUCHOM SYSTEM
        </button>

        {/* Narożniki */}
        {[
          { style: { top: 14, left: 14 } },
          { style: { top: 14, right: 14, transform: 'scaleX(-1)' } },
          { style: { bottom: 14, left: 14, transform: 'scaleY(-1)' } },
          { style: { bottom: 14, right: 14, transform: 'scale(-1)' } },
        ].map((c, i) => (
          <div key={i} style={{ position: 'fixed', width: 28, height: 28, opacity: .25, ...c.style }}>
            <svg viewBox="0 0 28 28"><path d="M0 28L0 0L28 0" fill="none" stroke="#D4A825" strokeWidth="1.8"/></svg>
          </div>
        ))}
      </div>
    )
  }

  // Animacja
  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, background: '#080c10', overflow: 'hidden', zIndex: 99999 }}
    />
  )
}
