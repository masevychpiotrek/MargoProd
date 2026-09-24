# Powiadomienia komunikatora

Implementacja obsługuje Web Push również po zamknięciu strony. Włączenie wymaga
zgody użytkownika na każdym urządzeniu. Treść wiadomości i nazwisko nadawcy nie
pojawiają się na ekranie blokady. Kliknięcie otwiera właściwą rozmowę.

## Uruchomienie na serwerze

1. Zastosuj `supabase/migrations/074_chat_web_push.sql`.
2. Uruchom `node scripts/create-chat-push-keys.mjs https://margoprod.vercel.app`.
   Prywatne wartości zostaną zapisane w ignorowanym pliku `.env.chat-push`.
   Zachowaj je bezpiecznie; nie generuj nowych kluczy przy każdym wdrożeniu.
3. W powiązanym projekcie Supabase wykonaj
   `npx supabase secrets set --env-file .env.chat-push`, następnie
   `npx supabase functions deploy send-chat-push --no-verify-jwt`.
   Funkcja sprawdza własny sekret `CHAT_PUSH_SECRET` w nagłówku żądania.
4. Ustaw w Vercel `VITE_WEB_PUSH_PUBLIC_KEY` na publiczny klucz wypisany przez
   skrypt. Nigdy nie dodawaj prywatnego klucza ani sekretu do zmiennych `VITE_*`.
5. W Supabase Vault dodaj `chat_push_url` wskazujący
   `https://<project-ref>.supabase.co/functions/v1/send-chat-push` oraz
   `chat_push_secret` równy `CHAT_PUSH_SECRET` z pliku konfiguracyjnego.
6. Wykonaj `supabase/setup_chat_push_delivery.sql`, a następnie wdróż frontend.
7. W komunikatorze wybierz „Włącz powiadomienia” i udziel zgody systemowej.
   Na iPhonie aplikacja musi być dodana do ekranu początkowego i uruchomiona stamtąd
   (iOS 16.4 lub nowszy): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/.

Wysyłkę uruchamia zapis wiadomości; zadanie co minutę ponawia nieudane próby.
Powiadomienia odczytanych wiadomości, nieaktywnych kont i zadania starsze niż dobę
są pomijane. Wygasłe subskrypcje są usuwane. Wylogowanie wyłącza powiadomienia
na urządzeniu; zmiana konta usuwa poprzednie przypisanie.

## Sprawdzenie wdrożenia

Użyj dwóch kont testowych za zgodą ich właścicieli. Odbiorca włącza powiadomienia
i zamyka aplikację. Wyślij wiadomość, sprawdź powiadomienie oraz otwarcie rozmowy.
Sprawdź też wyłączenie powiadomień i wylogowanie na urządzeniu współdzielonym.
Status dostarczenia znajduje się w `chat_push_jobs.result`; nie jest potwierdzeniem
odczytania przez człowieka. System operacyjny może opóźnić dostarczenie.

Testy lokalne: `node --test --test-isolation=none tests/chat-push.test.mjs`.
Obejmują uprawnienia, kolejkę, ponawianie, szyfrowanie i obsługę service workera;
nie zastępują sprawdzenia dostarczenia na telefon po wdrożeniu.
