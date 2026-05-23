# MargoProd MES — Moduł 1: Fundament

## Stack

* React 18 + TypeScript + Vite
* TailwindCSS + ShadCN UI
* React Query + Zustand
* Supabase (PostgreSQL + Auth + Realtime)
* Vercel (hosting)

\---

## Konfiguracja Supabase

### Krok 1 — SQL Editor: uruchom w tej kolejności

1. `supabase/migrations/001\_initial\_schema.sql`
2. `supabase/migrations/002\_helper\_functions.sql`
3. `supabase/seed.sql`

### Krok 2 — .env

```bash
cp .env.example .env
# Wklej dane z Supabase → Settings → API
```

### Krok 3 — Uruchomienie

```bash
npm install
npm run dev
```

\---

## Konta domyślne

|Rola|E-mail|Hasło|
|-|-|-|
|Admin|admin@margomed.pl|Margomed123|
|Kierownik|kierownik@margomed.pl|Margomed123|
|Operator|marcel.pelczynski@margomed.pl|Margomed123|

\---

## Struktura projektu

```
src/
├── components/
│   ├── layout/       ← AppLayout (sidebar + topbar)
│   └── shared/       ← KpiCard, StatusBadge...
├── features/
│   └── auth/         ← RequireAuth, RoleGuard
├── hooks/
│   └── useClock.ts   ← zegar, blok godzinowy, countdown
├── lib/
│   ├── supabase.ts   ← klient + query helpers
│   └── utils.ts      ← cn, labels, helpers
├── pages/
│   ├── Login.tsx
│   ├── operator/     ← Dashboard, Shift, Report, History
│   ├── manager/      ← Dashboard
│   └── admin/        ← Dashboard, Users
├── stores/
│   ├── authStore.ts  ← Zustand: user, profile, signIn/Out
│   └── shiftStore.ts ← Zustand: activeShift, startShift
└── types/
    └── database.ts   ← wszystkie typy TS

supabase/
├── migrations/
│   ├── 001\_initial\_schema.sql   ← pełny schemat DB
│   └── 002\_helper\_functions.sql ← create\_user\_with\_profile
└── seed.sql                     ← operatorzy, maszyny, harmonogram
```

\---

## Kolejne moduły

|Moduł|Co budujemy|
|-|-|
|**2**|Start zmiany — wybór maszyny, operatora, zmiany|
|**3**|Formularz raportu godzinowego — walidacja ≥2100, suma 60 min|
|**4**|System przestojów — kategorie, czasy, wielokrotne zdarzenia|
|**5**|Alerty — timer 09:58/09:59/10:00, push notifications, dźwięk|
|**6**|Dashboard operatora — status godziny, licznik, historia|
|**7**|Dashboard kierownika — live view, OEE, wykresy|
|**8**|Panel admina — użytkownicy, hasła, config|
|**9**|Harmonogram — dni wolne, przerwy|
|**10**|Raporty + export PDF/Excel|
|**11**|Audit log|
|**12**|PWA + offline mode|

\---

## Deploy na Vercel

```bash
npm run build
# lub połącz repo z Vercel — automatyczny deploy przy git push
```

Zmienne środowiskowe na Vercel:

* `VITE\_SUPABASE\_URL`
* `VITE\_SUPABASE\_ANON\_KEY` 


