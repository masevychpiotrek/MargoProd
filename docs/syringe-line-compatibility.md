# Linie strzykawkowe — rozmiar, warianty i przezbrojenie

## Ustalenie dotyczące asortymentów

Zgodnie z doprecyzowaniem użytkownika **Nominał i Standard są dwoma wariantami asortymentu**, które operator wybiera po wskazaniu linii. Nie są dwoma nowymi parametrami wpisywanymi podczas uruchomienia.

Asortyment miał już pojemność `volume_ml`, normę `nominal_per_hour`, cel zmianowy i cel braków. Dodano `variant` (Nominał/Standard). Migracja przypisuje istniejące katalogowe pozycje `SYR_2ML` … `SYR_100ML` do Nominału, zachowując ich identyfikatory i kody. Tworzy odpowiadające im pozycje Standard, kopiując dotychczasowe parametry. Nie ustalano nowych norm wydajności. Nazwy zawierają wariant, dzięki czemu jest widoczny także w istniejących raportach.

## Co było nieprawidłowe

- Linie nie miały strukturalnego pola rozmiaru. Rozmiar występował tylko w nazwach/kodach.
- Start zmiany i przezbrojenie pokazywały wszystkie aktywne asortymenty. Backend nie porównywał ich rozmiaru z linią.
- Backend dopuszczał zapis produkcji podczas przezbrojenia.
- Przy przezbrojeniu potwierdzano tylko licznik montażu, pomijając niezapisany przyrost druku.
- Norma i wydajność następnego wpisu mogły obejmować czas sprzed zakończenia przezbrojenia.
- Liczba wpisów z wcześniejszego asortymentu mogła blokować rozliczenie nowego segmentu.

Poprawnie działające mechanizmy zachowano: sesja operatora, przechodzenie między ekranami, autoryzacja, transakcyjny zapis i ponawianie żądań, liczniki narastające, rozliczanie braków, checklista oraz odejmowanie czasu przezbrojenia od czasu pracy całej zmiany.

## Zasady po zmianie

Linia ma `volume_ml`. Znane kody SA-2ML, SA-5ML, SA-10ML, SA-20ML, SA-50ML i SA-100ML otrzymują odpowiednie wartości. Inne linie wymagają uzupełnienia konfiguracji przez administratora; brak rozmiaru blokuje produkcję.

Wybór nowej linii czyści wcześniejszy asortyment i plan formularza. Start i przezbrojenie filtrują po zgodnej pojemności. Baza weryfikuje sesje, wpisy, przezbrojenia i przypisane do linii zlecenia. Bezpośrednie zapisy operatorskie nadal są zablokowane uprawnieniami. Zmiana rozmiaru wykorzystanej linii/asortymentu nie może zmienić znaczenia historii.

1. Operator zapisuje bieżącą produkcję i braki, wybiera kompatybilny wariant oraz potwierdza oba liczniki.
2. Start przezbrojenia zapisuje czas serwera, zamyka dotychczasowy segment i ustawia status przezbrojenia. Kolejny start oraz zapisy produkcji są odrzucane.
3. Ekran pokazuje czas trwania i checklistę. Przed zakończeniem można skorygować docelowy wybór w obrębie tej samej pojemności.
4. Zakończenie ponownie sprawdza zgodność i aktywność asortymentu oraz checklistę. Zapisuje koniec i czas trwania, przypisuje nowy asortyment, odłącza poprzednie zlecenie i uruchamia nowy segment.
5. Wyniki zachowują własne `assortment_id`. Liczniki pozostają narastające; reset wymaga dotychczasowego jawnego zgłoszenia. Korekta wcześniejszego segmentu jest blokowana, także po powrocie do tego samego wariantu.

Widok `sa_production_segments` odtwarza granice segmentów z sesji i przezbrojeń bez przepisywania wyników historycznych. Dokładność czasu zapewniają znaczniki czasowe; istniejące podsumowania minutowe nadal stosują zaokrąglenie do minut.

## Pliki

- `src/lib/syringeCompatibility.ts` — wspólne filtrowanie.
- `src/lib/syringeSettlement.ts` — zachowanie rozliczeń 50/100 ml dla Standardu.
- `src/types/database.ts` — rozmiar linii, wariant i początek segmentu.
- `src/pages/syringe/SessionStart.tsx` — wybór zgodny z linią.
- `src/pages/syringe/Changeover.tsx` — zgodne warianty, dwa liczniki, czas i wybór przy zakończeniu.
- `src/pages/syringe/ProductionEntry.tsx` — norma i limit w nowym segmencie, blokada podczas przezbrojenia.
- `src/pages/syringe/Dashboard.tsx` — liczba wpisów aktualnego segmentu.
- `src/pages/admin/SyringeAdmin.tsx` — konfiguracja rozmiarów i wariantów, filtrowanie zleceń.
- `supabase/migrations/069_syringe_line_compatibility.sql` — rozmiary, warianty i walidacja bazy.
- `supabase/migrations/070_syringe_changeover_segments.sql` — transakcyjne przezbrojenie i segmenty.
- `supabase/migrations/071_syringe_variant_norms.sql` — normy, limity segmentu i rozliczanie wariantów.
- `supabase/diagnostics/syringe_size_audit.sql` — audyt powiązań i braków konfiguracji.
- `tests/syringe-db.mjs` — konfiguracja testowej bazy i pełny zestaw istotnych migracji.
- `tests/syringe-compatibility.test.mjs` — nowe testy zgodności, segmentów i audytu.
- `tests/syringe-workflow.test.mjs` — przezbrojenie 2 ml → 2 ml.
- `tests/syringe-ui.spec.ts` — sprawdzenie wariantów i aktualnego przebiegu formularzy.
- `tests/syringe.playwright.config.ts` — dłuższy limit uruchamiania serwera testowego.
- `docs/syringe-line-compatibility.md` — ten opis.

## Wdrożenie i audyt używanej bazy

Zmiany przygotowano lokalnie. Należy zastosować migracje 069–071 po dotychczasowych migracjach, przed uruchomieniem nowej wersji interfejsu. Nie wykonano migracji na produkcyjnej bazie.

Próba odczytu sześciu tabel produkcyjnych dostępnym kluczem aplikacji zakończyła się HTTP 401 (`permission denied`). Nie można na tej podstawie stwierdzić, że baza jest wolna od błędnych powiązań. Po migracji należy uruchomić audyt SQL uprawnionym kontem. Audyt obejmuje sesje, wyniki, oba asortymenty przezbrojenia i zlecenia. Nie poprawia automatycznie historii. Jego wykrywanie celowo wprowadzonego błędu 2 ml → 5 ml sprawdzono w izolowanej bazie testowej.

## Weryfikacja

- Kontrola typów (`npm run typecheck`) — poprawna.
- Kompilacja produkcyjna (`npm run build`) — poprawna; istnieje ostrzeżenie o wielkości głównego pakietu.
- `node --test --experimental-test-isolation=none tests/syringe-*.test.mjs` — 9 testów zakończonych powodzeniem. Tryb jednego procesu omija ograniczenie uruchamiania procesów potomnych w środowisku roboczym.
- Testy obejmują: dwa warianty 2 ml, odrzucenie 5 ml i braku asortymentu, brak konfiguracji/nieaktywny wybór, powtórny start i koniec przezbrojenia, checklistę, blokadę produkcji w trakcie, oba liczniki, ponowną walidację przy zakończeniu, poprawne przypisanie wyników, ochronę historycznych rozmiarów, blokadę bezpośredniego zapisu, transakcje i bezpieczne ponowienia.
- Sprawdzono obliczenie 15 minut przezbrojenia oraz oś czasu 200 minut produkcji + 15 minut przezbrojenia + 265 minut produkcji: 465 minut produkcyjnych, 4650 dobrych sztuk zapisanych pod właściwymi asortymentami.
- Osobny test sprawdza zapis po wykorzystaniu 8 wpisów poprzedniego segmentu oraz brak fałszywej przyczyny niskiej wydajności po długim przezbrojeniu.
