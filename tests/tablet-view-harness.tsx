import React from 'react'
import { createRoot } from 'react-dom/client'
import { useTabletKeyboard } from '../src/hooks/useTabletKeyboard'
import FullscreenButton from '../src/components/layout/FullscreenButton'
import '../src/index.css'

function Harness() {
  useTabletKeyboard()
  return <div className="app-shell production-orders">
    <div className="app-toolbar sticky top-0 bg-navy-800 p-3">Nawigacja <FullscreenButton /></div>
    <main className="app-content p-4">
      <h1>Zlecenie produkcyjne</h1>
      <div style={{ height: 900 }} />
      <div data-input-context className="card space-y-2">
        <label htmlFor="series">Numer serii drenu</label>
        <div className="flex gap-2">
          <input id="series" className="input" />
          <button className="btn-primary" onClick={() => (document.activeElement as HTMLElement)?.blur()}>Zapisz serię</button>
        </div>
      </div>
    </main>
    <div className="app-assistant fixed right-4 bottom-4">Asystent</div>
  </div>
}
createRoot(document.getElementById('root')!).render(<Harness />)
