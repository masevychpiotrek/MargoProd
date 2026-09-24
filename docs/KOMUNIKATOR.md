# Komunikator MargoLine

Zakładka **Wiadomości** w górnym pasku otwiera prywatne rozmowy jeden do jednego.
Obsługuje operatorów IS PRO i strzykawek, kierowników, specjalistów, zarząd
i administratorów. Konta demonstracyjne, nieaktywne i usunięte nie mogą korzystać
z komunikatora ani być wybierane do nowych rozmów.

## Uruchomienie

1. W bazie tej aplikacji uruchom `supabase/migrations/073_internal_messenger.sql`.
   Plik jest transakcyjny; należy zastosować go raz. Wymaga istniejącej tabeli
   `profiles`, funkcji `auth.uid()` i ról Supabase `anon` / `authenticated`.
2. Wdróż aplikację z nowymi plikami komunikatora.
3. Na dwóch kontach testowych sprawdź nową rozmowę, odpowiedź, licznik
   nieprzeczytanych i oznaczenie „Odczytano”. Nie używaj kont operatorów do
   rozsyłania wiadomości testowych bez uzgodnienia.

Brak migracji wyświetla komunikat o potrzebie aktywacji. Publikacja
`supabase_realtime`, jeżeli istnieje, dostaje obie nowe tabele. Dodatkowo aplikacja
odświeża listę rozmów co 20 sekund, a otwartą historię co 10 sekund, również gdy
połączenie Realtime jest niedostępne.

## Zachowanie

- Wybór osoby po nazwisku lub roli, także między IS PRO i strzykawkami.
- Wiadomości tekstowe do 4000 znaków, historia i wczytywanie starszych wiadomości.
- Enter wysyła, Shift+Enter dodaje nowy wiersz.
- „Wysłano” oznacza zapis w bazie. „Odczytano” oznacza otwarcie aktualnych
  wiadomości w widocznej karcie rozmówcy; nie jest potwierdzeniem wykonania zadania.
- Szkice i klucze ponawiania są zachowane przy przełączaniu rozmów w obrębie
  otwartej strony. Odświeżenie lub opuszczenie strony usuwa niewysłane szkice.
- Ponowienie tej samej wysyłki po utracie odpowiedzi nie tworzy duplikatu.
- Nieaktywne konto rozmówcy blokuje nowe wiadomości, ale historia pozostaje.
- Moduł nie obejmuje grup, zdjęć, plików ani połączeń.
- Opcjonalne powiadomienia systemowe po zamknięciu aplikacji wymagają konfiguracji
  serwera i zgody użytkownika — instrukcja w `CHAT_PUSH.md`.

## Dostęp do danych

Reguły RLS pozwalają czytać rozmowę tylko jej dwóm uczestnikom, także dla roli
administratora aplikacji. Bezpośrednie zapisy, edycja i usuwanie przez klienta są
zablokowane; wysyłka i odczyt korzystają z kontrolowanych funkcji bazy.
Nadawca jest zawsze wyznaczany z sesji logowania. Katalog kontaktów ujawnia tylko
identyfikator, imię i nazwisko oraz rolę. Moduł nie zmienia dostępu do danych
produkcyjnych. To komunikator z kontrolą dostępu w bazie, bez szyfrowania end-to-end.

## Weryfikacja lokalna

- `npm run typecheck`
- `npm run test:messenger` — izolowana baza PostgreSQL (PGlite), uprawnienia,
  ponawianie, walidacja, paginacja i potwierdzenia odczytu.
- `npm run test:messenger:ui` — Edge, komputer i telefon, osobna lokalna baza;
  testy nie łączą się z produkcyjną bazą ani nie wysyłają prawdziwych wiadomości.
- `npm run build`
