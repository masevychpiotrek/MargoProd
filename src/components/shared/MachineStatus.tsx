type Status = 'run' | 'alarm' | 'stop'

interface Props {
  status: Status
  size?: number
}

export function MachineStatusDot({ status, size = 12 }: Props) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      {status === 'run' && (
        <>
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: '#10B981', opacity: 0.3,
            animation: 'ml-pulse-run 1.5s ease-in-out infinite'
          }} />
          <span style={{
            position: 'absolute', inset: size * 0.18,
            borderRadius: '50%', background: '#10B981',
            animation: 'ml-heartbeat 1.5s ease-in-out infinite'
          }} />
        </>
      )}
      {status === 'alarm' && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: '#EF4444',
          animation: 'ml-alarm-blink 0.6s ease-in-out infinite'
        }} />
      )}
      {status === 'stop' && (
        <span style={{
          position: 'absolute', inset: size * 0.12,
          borderRadius: '50%', background: '#374151'
        }} />
      )}
      <style>{`
        @keyframes ml-pulse-run   { 0%,100%{transform:scale(1);opacity:.3} 50%{transform:scale(1.7);opacity:.1} }
        @keyframes ml-heartbeat   { 0%,100%{transform:scale(1)} 15%{transform:scale(1.35)} 30%{transform:scale(1)} 45%{transform:scale(1.2)} 60%{transform:scale(1)} }
        @keyframes ml-alarm-blink { 0%,100%{opacity:1} 45%{opacity:.1} }
      `}</style>
    </span>
  )
}

export function MachineStatusBadge({ status }: { status: Status }) {
  const cfg = {
    run:   { label: 'RUN',   color: '#10B981', bg: 'rgba(16,185,129,.1)',  border: 'rgba(16,185,129,.25)' },
    alarm: { label: 'ALARM', color: '#EF4444', bg: 'rgba(239,68,68,.1)',   border: 'rgba(239,68,68,.25)' },
    stop:  { label: 'STOP',  color: '#6B7280', bg: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.15)' },
  }[status]

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 8,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      color: cfg.color, fontSize: 11, fontWeight: 700, letterSpacing: '.08em'
    }}>
      <MachineStatusDot status={status} size={8} />
      {cfg.label}
    </span>
  )
}

export function getMachineStatus(online: boolean, alarmMin: number): Status {
  if (!online) return 'stop'
  if (alarmMin > 20) return 'alarm'
  return 'run'
}
