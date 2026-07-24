import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { compressImage } from '@/lib/imageCompression'
import {
  SEMI_PRODUCTS, DEFECT_TYPES, defectTypeLabel, semiProductLabel,
  complaintStatusLabel, complaintStatusTone, isPlausibleBatchNumber
} from '@/lib/complaints'
import type { InternalComplaint } from '@/types/database'

const TONE_CLASS: Record<string, string> = {
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  green: 'border-green-500/30 bg-green-500/10 text-green-400',
  red: 'border-red-500/30 bg-red-500/10 text-red-300'
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function OperatorQualityComplaint() {
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()

  const [batchNumber, setBatchNumber] = useState('')
  const [productionDate, setProductionDate] = useState(today())
  const [semiProduct, setSemiProduct] = useState('')
  const [defectType, setDefectType] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [mine, setMine] = useState<InternalComplaint[]>([])

  const loadMine = async () => {
    if (!profile) return
    const { data } = await supabase
      .from('internal_complaints')
      .select('*')
      .eq('reporter_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setMine((data ?? []) as InternalComplaint[])
  }

  useEffect(() => { loadMine() }, [profile?.id])

  const pickPhoto = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  const reset = () => {
    setBatchNumber(''); setProductionDate(today()); setSemiProduct('')
    setDefectType(''); setDescription(''); setPhoto(null); setPreview(null)
  }

  const handleSubmit = async () => {
    if (!profile) return
    // Twarda walidacja - komplet danych, zeby zgloszenie bylo uzyteczne.
    if (!isPlausibleBatchNumber(batchNumber)) { setError('Wpisz poprawny numer serii / partii.'); return }
    if (!semiProduct) { setError('Wybierz typ półfabrykatu.'); return }
    if (!defectType) { setError('Wybierz typ niezgodności.'); return }
    if (defectType === 'inna' && description.trim().length < 5) {
      setError('Dla „Inna niezgodność" opisz wadę w uwagach.'); return
    }
    setError('')
    setSaving(true)
    try {
      let photoUrl: string | null = null
      if (photo) {
        const compressed = await compressImage(photo)
        const ext = compressed.name.split('.').pop() ?? 'jpg'
        const path = `complaints/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error: upErr } = await supabase.storage.from('failure-photos').upload(path, compressed, {
          cacheControl: '3600', upsert: false
        })
        if (upErr) throw new Error('Nie udało się dodać zdjęcia: ' + upErr.message)
        photoUrl = supabase.storage.from('failure-photos').getPublicUrl(path).data.publicUrl
      }

      const { error: insErr } = await supabase.from('internal_complaints').insert({
        reporter_id: profile.id,
        shift_id: activeShift?.id ?? null,
        machine_id: activeMachine?.id ?? null,
        batch_number: batchNumber.trim(),
        production_date: productionDate || null,
        semi_product: semiProduct,
        defect_type: defectType,
        description: description.trim() || null,
        photo_url: photoUrl
      })
      if (insErr) throw new Error(insErr.message)

      setSaved(true)
      setTimeout(() => setSaved(false), 3500)
      reset()
      await loadMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać zgłoszenia.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Reklamacja wewnętrzna</h1>
        <p className="text-sm text-navy-400 mt-1">Zgłoś wykrytą wadę jakościową półfabrykatu.</p>
      </div>

      {saved && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm font-semibold text-green-300">
          Zgłoszenie zapisane. Dziękujemy.
        </div>
      )}

      <div className="card space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Numer serii / partii *</label>
            <input value={batchNumber} onChange={e => { setBatchNumber(e.target.value); setError('') }}
              placeholder="Np. 2026-07-A12" className="input mt-1" />
          </div>
          <div>
            <label className="label">Data produkcji</label>
            <input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)} className="input mt-1" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Typ półfabrykatu *</label>
            <select value={semiProduct} onChange={e => { setSemiProduct(e.target.value); setError('') }} className="input mt-1">
              <option value="">Wybierz...</option>
              {SEMI_PRODUCTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Typ niezgodności *</label>
            <select value={defectType} onChange={e => { setDefectType(e.target.value); setError('') }} className="input mt-1">
              <option value="">Wybierz...</option>
              {DEFECT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Opis / uwagi {defectType === 'inna' && <span className="text-amber-400">(wymagane dla „Inna")</span>}</label>
          <textarea value={description} onChange={e => { setDescription(e.target.value); setError('') }}
            rows={3} placeholder="Np. wypływka na kołnierzu komory, widoczna na całej partii..." className="input mt-1 resize-none" />
        </div>

        <div>
          <label className="label">Zdjęcie wady</label>
          {preview ? (
            <div className="mt-1 relative inline-block">
              <img src={preview} alt="Podgląd wady" className="max-h-56 rounded-xl border border-navy-700" />
              <button onClick={() => { setPhoto(null); setPreview(null) }}
                className="absolute top-2 right-2 rounded-lg bg-navy-900/80 border border-navy-600 text-navy-200 hover:text-red-300 w-8 h-8 text-sm">✕</button>
            </div>
          ) : (
            <label className="mt-1 flex items-center justify-center rounded-xl border border-dashed border-navy-600 bg-navy-900 py-6 text-sm text-navy-400 cursor-pointer hover:border-brand/40 hover:text-brand transition-all">
              📷 Dodaj zdjęcie wady
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { pickPhoto(e.target.files); e.target.value = '' }} />
            </label>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</div>
        )}

        <button onClick={handleSubmit} disabled={saving} className="btn-primary w-full py-3 text-base disabled:opacity-50">
          {saving ? 'Zapisywanie...' : 'Zgłoś reklamację'}
        </button>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Moje ostatnie zgłoszenia</div></div>
        {mine.length === 0 ? (
          <div className="text-center py-6 text-sm text-navy-500">Brak zgłoszeń</div>
        ) : (
          <div className="space-y-2">
            {mine.map(c => (
              <div key={c.id} className="rounded-xl border border-navy-700 bg-navy-900 p-3 flex items-center gap-3">
                {c.photo_url && <img src={c.photo_url} alt="Wada" className="w-12 h-12 object-cover rounded-lg border border-navy-600 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white font-medium truncate">{defectTypeLabel(c.defect_type)} · {semiProductLabel(c.semi_product)}</div>
                  <div className="text-xs text-navy-400">Seria {c.batch_number} · {new Date(c.created_at).toLocaleDateString('pl-PL')}</div>
                </div>
                <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border', TONE_CLASS[complaintStatusTone(c.status)])}>
                  {complaintStatusLabel(c.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
