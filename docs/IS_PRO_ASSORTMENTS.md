# IS PRO — asortymenty i przezbrojenia

## Obsługa

Na początku produkcji operator wybiera asortyment i potwierdza zerowe liczniki dobrych sztuk oraz odrzutu. Kolejne wpisy godzinowe pozostają odczytami narastającymi dla tego asortymentu.

„Rozpocznij przezbrojenie” prosi o końcowy stan obu liczników. Zatwierdzenie zapisuje niezarejestrowany przyrost i uruchamia zegar według czasu serwera. Następnie operator wybiera nowy asortyment, zeruje liczniki i naciska „Rozpocznij produkcję”. W czasie przezbrojenia zapis wyników jest blokowany.

Przykład: odczyty A: 2000, 4560, końcowy 5100; odczyty B: 150, 2341. Podsumowanie pokazuje A: 5100, B: 2341, razem 7441 dobrych sztuk. Odczytów narastających nie sumujemy. Odrzut jest rozliczany oddzielnie.

Na końcu zmiany operator wpisuje końcowe liczniki aktualnego asortymentu. Zamknięte asortymenty są doliczane automatycznie. Podział i czas przezbrojeń są dostępne na ekranach operatora i w sekcji „Asortymenty i czas przezbrojeń — porównanie zmian” w Raporcie dnia.

## Czas i historia

Przezbrojenie pozostaje aktywne po zamknięciu zmiany i kończy się przy rozpoczęciu następnej produkcji na tej maszynie. Raport przypisuje każdej zmianie tylko część zdarzenia pokrywającą jej czas, z ograniczeniem do granic zmian. Nowy asortyment ma oddzielny licznik i może mieć wpis w tej samej godzinie co poprzedni. Norma pierwszego niepełnego bloku uwzględnia moment rozpoczęcia asortymentu. Godziny spędzone w całości na przezbrojeniu nie wymagają fikcyjnych wpisów produkcyjnych.

Zamknięte odcinki są chronione przed zmianą wyników. Dotychczasowy mechanizm korekty raportów nie może przepisywać ich liczników. Historyczne zmiany bez asortymentów pozostają bez automatycznego przypisania; nowego przebiegu nie można włączać w połowie takiej zmiany.

## Uruchomienie

Przed publikacją frontendu zastosuj `supabase/migrations/081_is_pro_assortment_changeovers.sql` na docelowej bazie. Migracja jest transakcyjna, dodaje tabele odcinków i przezbrojeń, powiązanie raportów i funkcję przejść. Nie przypisuje asortymentów do historii. Wymaga istniejących aktywnych pozycji w tabeli `assortments`.

Zmiany bazy nie zostały zastosowane do działającego środowiska w ramach lokalnej implementacji.

## Weryfikacja

- `npm run test:is-pro` — rzeczywisty SQL w izolowanym PostgreSQL/PGlite: reset licznika, końcowy przyrost, suma zmiany, ponowienie operacji, uprawnienia i przejście przez granicę zmian.
- `npm run test:is-pro:ui` — przebieg operatora i brak przewijania poziomego na komputerze oraz telefonie, przy testowych odpowiedziach API.
- `npm run typecheck` oraz `npm run build`.
