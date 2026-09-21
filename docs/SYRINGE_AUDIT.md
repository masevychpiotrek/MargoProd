# Linie strzykawkowe: poprawki i testy

## Zasady obliczen

- Nowa zmiana zawsze zaczyna liczniki druku i montazu od zera, zgodnie z potwierdzeniem operatora procesu.
- Druk: biezacy stan minus poprzedni stan tej samej zmiany.
- Dobre sztuki: analogiczny przyrost licznika montazu.
- Braki: przyrost druku minus przyrost montazu. Potwierdzono, ze roznica nie obejmuje produkcji w toku.
- Odrzut procentowy: braki / (dobre + braki), a nie braki / dobre.
- Realizacja planu: dobre / plan zapisany przy rozpoczeciu zmiany. Wynik moze przekroczyc 100%.
- Wydajnosc wpisu: przyrost dobrych / czas miedzy wpisami. Pierwszy wpis i odstep ponizej 5 minut nie maja ekstrapolowanej wydajnosci; rzeczywisty brak przyrostu daje 0 szt/h.
- Srednia zmiany: suma dobrych / czas od rozpoczecia zmiany. Obejmuje postoje; nie jest chwilowa predkoscia maszyny.
- Czas aktywny: czas zmiany minus zarejestrowane postoje i przezbrojenia. Nakladajace sie przedzialy sa laczone.
- Dzien produkcyjny: 06:00-06:00, Europe/Warsaw. Raporty brakow i postojow sa filtrowane wedlug daty i numeru ich zmiany.

## Poprawione problemy

- Wynik, kategorie brakow, sumy sesji i przyrost zlecenia zapisuja sie w jednej transakcji.
- Ponowienie tej samej operacji po utracie odpowiedzi nie powiela wynikow. Serwer odrzuca zapis na nieaktualnym poprzednim wpisie.
- Jedna aktywna zmiana na automat i operatora; serwer sprawdza zajetosc takze dla zmian innego operatora, niewidocznych przez RLS.
- Zakonczenie zmiany sprawdza oba koncowe liczniki. Nowa produkcje trzeba rozliczyc w formularzu produkcji; przekazanie nie dopisuje juz fikcyjnego wpisu bez brakow.
- Ostatni wpis aktywnej zmiany mozna poprawic z uzasadnieniem. Pierwotny rekord pozostaje oznaczony jako anulowany; sumy i kolejna podpowiedz sa przeliczane.
- Nie mozna zamknac zmiany podczas aktywnego postoju/przezbrojenia ani uruchomic dwoch takich zdarzen jednoczesnie.
- Przezbrojenie wymaga aktualnego zapisu produkcji i zatwierdzenia checklisty. Checklista reaguje na klikniecie calej etykiety i klawiature.
- Nowe wpisy zachowuja asortyment z chwili zapisu, nawet po pozniejszym przezbrojeniu. Po przezbrojeniu stare zlecenie jest odpinane.
- Zgloszenie awarii/jakosci z zatrzymaniem rejestruje rowniez czas postoju. Sam status nie zastepuje formularza postoju.
- Raporty nie lacza wybranej zmiany z brakami i postojami pozostalych zmian; anulowane wpisy sa pomijane. Dane raportu pobierane sa stronami.
- Bledy odczytu/zapisu sa pokazywane zamiast komunikatu sukcesu albo pustej listy. Zapis ma limit oczekiwania 20 sekund.
- Poprawiono mianownik odrzutu i zrodlo planu w raporcie e-mail. Zmiana planu w asortymencie nie nadpisuje planu juz zapisanej sesji.

## Wdrozenie

1. Przygotuj aktualna kopie bazy oraz krotkie okno serwisowe dla linii strzykawkowych.
2. W Supabase SQL Editor uruchom caly plik `supabase/migrations/060_syringe_workflow_hardening.sql`. Zaklada istniejace tabele z migracji 035 i kolumny z 042. Nie uruchamiaj ponownie wszystkich starych migracji.
3. Wdroz kod aplikacji z tej poprawki i odswiez otwarte stanowiska. Stara wersja aplikacji nie moze zapisywac bezposrednio do zabezpieczonych tabel po migracji.
4. Sprawdz logowanie i jedna kontrolowana zmiane na docelowym Supabase. Testy lokalne nie potwierdzaja wdrozenia do produkcyjnej bazy ani konfiguracji jej API.
5. Opcjonalnie uruchom `supabase/diagnostics/syringe_workflow_audit.sql`. To tylko odczyt: wykrywa stare rozbieznosci i nie usuwa danych.

Migracja nie usuwa ani nie przelicza masowo starych rekordow. Ich zgodnosc z fizycznymi odczytami wymaga osobnej weryfikacji. Nowe zapisy sumuja nieanulowane wpisy sesji.

## Testy

- `npm run test:syringe`: testy obliczen oraz rzeczywistego SQL w odizolowanym PostgreSQL/PGlite, z rolami i kontrola uprawnien.
- `npm run test:syringe:ui`: formularze aplikacji w Edge, widok komputerowy/tablet/telefon. Transport Supabase jest zastepowany lokalnym adapterem wywolujacym ten sam SQL; produkcyjna baza nie jest uzywana.
- `npm run typecheck` oraz `npm run build`.

Scenariusze obejmuja kolejne wpisy, korekte, brakujace kategorie, odczyty ulamkowe/ujemne, reset, ponowienie po bledzie/utracie odpowiedzi, nowa zmiane od zera, postoje, przezbrojenie, komponenty, awarie, jakosc, raport oraz zmiane daty o 06:00 i czasu letniego/zimowego.
