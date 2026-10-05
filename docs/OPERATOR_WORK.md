# Wspólny wykaz pracy operatorów

Ekran `/manager/operators` zastępuje poprzedni ranking IS PRO. Jest dostępny
dla kierownika, administratora, zarządu i dotychczasowego odbiorcy z rolą viewer,
zgodnie z uprawnieniami do odczytu danych w bazie. Pozycja menu: „Operatorzy i wyniki”.

Domyślnie pokazuje bieżący miesiąc do aktualnej daty produkcyjnej. Filtry obejmują
okres, moduł, maszynę, zmianę, operatora i wyszukiwanie po nazwisku. Ranking można
sortować według dobrych sztuk, liczby zmian, udziału braków lub nazwiska. Kliknięcie
operatora zawęża wykaz. Eksport CSV zawiera wszystkie pasujące przydziały, również
te poza aktualną stroną tabeli, w formacie UTF-8 zgodnym z polskim Excelem.

## Znaczenie wyniku

- IS PRO: wynik operatora jest sumą jego nieusuniętych wpisów godzinowych.
  Przydziały z obu pól operatorów zmiany są widoczne także bez raportów.
  Pełny wynik maszyny nie jest przypisywany każdemu członkowi obsady.
- Automaty strzykawkowe: wyniki i czasy pochodzą z podsumowania sesji operatora;
  nie dodajemy do nich ponownie wpisów produkcyjnych. Widoczny jest asortyment
  sesji oraz status, w tym automatyczne zamknięcie.
- Tożsamość operatora jest wyznaczana przez identyfikator konta, nie nazwisko.
  Maszyny mają identyfikator z prefiksem modułu, więc nie zlewają się między modułami.
- Daty filtrów oznaczają daty produkcyjne, także na nocnej zmianie.
  Godziny pokazujemy według Europe/Warsaw. W IS PRO to granice całej zmiany na
  maszynie; system nie posiada osobnej ewidencji wejścia i wyjścia każdego operatora.
- „—” oznacza brak zapisanej wartości; zero oznacza zapisane zero. Sumaryczny
  czas jest nieznany, gdy choć jeden przydział nie ma odpowiedniego pomiaru.
  Liczby sztuk w rankingu sumują dostępne wartości i oznaczają brakujące wyniki.
- Ranking według sztuk nie jest oceną wydajności względem normy: produkty i
  maszyny mają różne możliwości. Usunięto wcześniejszy wspólny arbitralny wynik W EPQ.

Historia konfiguracji obejmuje również nieaktywne maszyny i operatorów, jeśli
bieżące konto ma dostęp do powiązanych danych. Dane są pobierane stronami po 500,
aby ranking miesięczny nie kończył się na limicie 1000 rekordów. Błąd jednego
źródła blokuje prezentację i eksport niepełnego rankingu. Odświeżanie co minutę
oraz przy powrocie do okna; dostępne jest też ręczne odświeżenie.

Wdrożenie wymaga publikacji frontendu, bez nowej migracji ani zmiany uprawnień bazy.
Testy: `node --test --test-isolation=none tests/operator-work.test.mjs` oraz
`npx playwright test --config tests/operator-work.playwright.config.ts`.
