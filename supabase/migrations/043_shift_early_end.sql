-- Jawne, opisane zakonczenie zmiany przedwczesnie (przed uzupelnieniem wszystkich blokow godzinowych).
-- Wczesniej brak takiej opcji prowadzil do cichego pomijania ostatniego bloku (patrz walidacja w Shift.tsx).
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS ended_early boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_end_reason text;
