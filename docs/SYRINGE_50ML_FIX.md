# Wybór i zapis zmiany na linii 50 ml

Przyczyna odtworzona na danych z migracji: linia `SA-50ML` ma `volume_ml=50`,
natomiast oryginalny asortyment `SYR_50ML` („Strzykawka 50/60 ml”) ma
`volume_ml=60`. Wariant Standard odziedziczył tę wartość. Ścisłe porównanie
ukrywało oba warianty i odrzucało rozpoczęcie zmiany w bazie.

Poprawka rozpoznaje te dwie katalogowe pozycje jako produkty linii 50 ml,
wyłącznie gdy ich zapisana pojemność wynosi 60. Pozostałe rozmiary nadal muszą
być zgodne. Nie zmienia identyfikatorów, pojemności katalogowych ani historii.
Dotyczy wyboru, zapisu zmiany, produkcji, przezbrojenia i zleceń.

Wdrożenie: wykonać `supabase/migrations/076_syringe_50_60_compatibility.sql`
w używanej bazie, następnie wdrożyć frontend. Obie części są konieczne.
Nie ma potrzeby ponownego wykonywania starych migracji ani wyłączania kontroli
zgodności. Poprawka nie uzupełnia brakującej konfiguracji innych linii.

Test regresji: `node --test --test-isolation=none tests/syringe-50ml.test.mjs`.
Odtwarza pierwotną odmowę, sprawdza oba warianty z rzeczywistych danych
startowych oraz zapis produkcji i odrzucanie niezgodnych rozmiarów.
