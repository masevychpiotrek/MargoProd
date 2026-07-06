# Raport migracyjny — Margoline MES

**Odbiorca:** Dział IT Margomed S.A.
**Cel:** Przeniesienie aplikacji Margoline z obecnego środowiska (Vercel + Supabase Cloud) na infrastrukturę firmową, jako stabilne, bezpieczne i w pełni działające rozwiązanie produkcyjne.
**Status dokumentu:** Analiza techniczna na podstawie kodu źródłowego repozytorium. Nie wprowadzono zmian w kodzie. Nie wykonano migracji.

**Legenda statusów ustaleń:**
- ✅ **Potwierdzony** — wynika wprost z kodu/konfiguracji w repozytorium.
- 🟡 **Częściowo potwierdzony** — wynika z kodu, ale wymaga weryfikacji w środowisku uruchomieniowym.
- ⚪ **Niezweryfikowany** — brak danych w repozytorium.
- 📞 **Wymaga informacji od dostawcy/administratora** — dane są poza repozytorium (konto Supabase, Vercel, DNS).

> **Uwaga metodyczna:** Repozytorium zawiera kod i migracje. **Nie zawiera** dostępu do działającej bazy produkcyjnej, konta Supabase, konta Vercel ani plików w Storage. Dlatego wszystkie wielkości „runtime" (liczba rekordów, rozmiar bazy, rozmiar plików, realny ruch) są oznaczone jako wymagające dostępu/potwierdzenia.

---

## 1. Podsumowanie wykonawcze

Margoline to **jednostronicowa aplikacja webowa (SPA)** w React, której całą warstwę backendową realizuje **Supabase** — platforma typu Backend-as-a-Service. Oznacza to, że „backend" nie jest osobnym serwerem aplikacyjnym Margomedu, lecz zestawem usług zarządzanych Supabase:

- **Baza danych:** PostgreSQL (z RLS, rozszerzeniami, funkcjami, triggerami)
- **API:** automatyczne REST/Realtime generowane przez Supabase (PostgREST + WebSocket)
- **Logowanie/Autoryzacja:** Supabase Auth (GoTrue) — e-mail/hasło + logowanie RFID
- **Magazyn plików:** Supabase Storage (bucket `failure-photos`)
- **Logika serwerowa:** 2 funkcje brzegowe (Deno) — tworzenie użytkownika, logowanie RFID

**Kluczowy wniosek migracyjny:** Przeniesienie „na firmowe serwery" **nie jest skopiowaniem plików**. Wymaga decyzji strategicznej:
- **Wariant A — Self-hosting Supabase** (Docker, pełen stos Supabase na serwerze firmowym). Zachowuje architekturę, najmniej zmian w kodzie.
- **Wariant B — Zastąpienie Supabase** własnym backendem (PostgreSQL + osobne API + osobny Auth + osobny storage). Duży nakład, przebudowa.

**Rekomendacja wstępna:** Wariant A (self-hosting Supabase przez Docker Compose) jako jedyny realny sposób zachowania funkcjonalności, ról, historii i integralności danych bez przepisywania aplikacji. Szczegóły w sek. 16 i 25.

---

## 2. Architektura aplikacji

### 2.1 Schemat techniczny

```
┌─────────────┐
│ Użytkownik  │ Operator / Specialist / Kierownik / Zarząd / Admin
└──────┬──────┘
       │ HTTPS
┌──────▼────────────────────────┐
│ Przeglądarka / urządzenie     │ PWA (instalowalna), tryb landscape
│ komputer · tablet · telefon   │ cache: service worker (Workbox)
└──────┬────────────────────────┘
       │ statyczne pliki (HTML/JS/CSS)
┌──────▼────────────────────────┐
│ FRONTEND (SPA)                │ React 18 + TypeScript + Vite
│ hosting statyczny (Vercel)    │ React Router, React Query, Zustand
└──────┬────────────────────────┘
       │ HTTPS REST + WebSocket (Realtime), JWT w nagłówku
┌──────▼────────────────────────────────────────────────────┐
│ SUPABASE (Backend-as-a-Service)                            │
│  ├─ PostgREST  →  automatyczne REST API z tabel/Widoków     │
│  ├─ GoTrue     →  Auth (e-mail/hasło, RFID→magiclink/OTP)   │
│  ├─ Realtime   →  subskrypcje WebSocket (zmiany w tabelach) │
│  ├─ Storage    →  pliki (bucket failure-photos)            │
│  └─ Edge Funcs →  Deno: admin-create-user, rfid-login      │
└──────┬─────────────────────────────────────────────────────┘
       │ SQL (RLS wymusza uprawnienia per rola)
┌──────▼────────────────────────┐
│ BAZA DANYCH PostgreSQL        │ ~45 tabel, RLS, triggery, funkcje
│ rozszerzenia: uuid-ossp,      │ indeksy, ograniczenia CHECK/FK
│ pgcrypto                      │ audyt (audit_logs, *_history)
└────────────────────────────────┘

USŁUGI ZEWNĘTRZNE (wychodzące z frontendu/funkcji):
  • Microsoft Teams — webhook powiadomień o awariach (VITE_TEAMS_WEBHOOK_URL)
  • cdnjs (Cloudflare) — ExcelJS ładowany z CDN do eksportu XLSX
```

### 2.2 Stos technologiczny — ✅ potwierdzony (z `package.json`)

**Frontend / języki / frameworki:**
| Element | Technologia | Wersja |
|---|---|---|
| Język | TypeScript | ^5.2.2 |
| Framework UI | React | ^18.2.0 |
| Bundler / dev server | Vite | ^5.2.0 |
| Routing | react-router-dom | ^6.22.3 |
| Stan serwera | @tanstack/react-query | ^5.28.0 |
| Stan globalny | zustand | ^4.5.2 |
| Formularze / walidacja | react-hook-form + zod | ^7.51 / ^3.22 |
| Style | TailwindCSS | ^3.4.1 |
| Komponenty UI | Radix UI (ShadCN) | 1.x–2.x |
| Wykresy | chart.js + react-chartjs-2 | ^4.4 / ^5.2 |
| Ikony | lucide-react | ^0.368 |
| Daty | date-fns | ^3.6 |
| PWA | vite-plugin-pwa (Workbox) | ^0.19.8 |
| Klient backendu | @supabase/supabase-js | ^2.43 |

**Backend:** Supabase (PostgreSQL + PostgREST + GoTrue + Realtime + Storage + Edge Functions w Deno). Brak własnego serwera aplikacyjnego (Node/Java/PHP). ✅

**Eksport XLSX:** biblioteka ExcelJS **nie jest** zależnością npm — ładowana dynamicznie z CDN `cdnjs.cloudflare.com` w czasie działania. ✅ (istotne dla środowiska odizolowanego od internetu — patrz ryzyka).

### 2.3 Mechanizmy aplikacyjne — ✅ potwierdzone z kodu
- **Komunikacja FE–BE:** REST (PostgREST) + WebSocket (Realtime), autoryzacja przez JWT.
- **Logowanie:** Supabase Auth, e-mail/hasło; alternatywnie RFID (funkcja `rfid-login` mapuje UID karty → token magiclink/OTP).
- **Autoryzacja:** role w tabeli `profiles` (`operator`, `syringe_operator`, `specialist`, `manager`, `executive`, `viewer`, `admin`) + **Row Level Security** na poziomie bazy (każda tabela ma polityki RLS).
- **Sesje:** JWT przechowywany w `window.sessionStorage` (sesja ginie po zamknięciu karty), auto-odświeżanie tokenu.
- **Dane:** PostgreSQL.
- **Pliki/zdjęcia/filmy:** Supabase Storage, bucket `failure-photos` (publiczny URL), powiązanie przez kolumny `*_url`/`photo_urls` i tabelę `tpm_media`.
- **Raporty:** generowane **po stronie klienta** (XLSX przez ExcelJS z CDN; PDF przez okno druku przeglądarki; CSV przez Blob). Brak serwerowego generatora PDF.
- **Powiadomienia:** wewnętrzne (tabela `notifications`) + zewnętrzne do Microsoft Teams (webhook).
- **Harmonogramy/zadania automatyczne:** brak cron/kolejek serwerowych. Harmonogram PM i wykrywanie powtarzalności są wyzwalane **na żądanie** (przycisk → RPC). 🟡 — brak zadań w tle.

---

## 3. Aktualne środowisko — stan obecny

| Element | Ustalenie | Status |
|---|---|---|
| Hosting frontendu | Vercel (z README i konfiguracji PWA) | 🟡 potwierdzić w panelu Vercel |
| Typ hostingu FE | Statyczny hosting SPA + CDN | ✅ |
| Backend / baza | Supabase Cloud (projekt `yuofvnitpgipezymkihz` z `.temp/project-ref`) | 🟡/📞 |
| System operacyjny serwerów | Zarządzany przez Supabase/Vercel (brak dostępu) | 📞 |
| Sposób uruchamiania | FE: build statyczny; BE: usługi zarządzane Supabase | ✅ |
| Domena | ⚪ brak w repo | 📞 |
| Konfiguracja DNS | ⚪ brak w repo | 📞 |
| Certyfikat SSL | Zarządzany przez Vercel/Supabase (automatyczny) | 🟡 |
| Lokalizacja danych (region) | ⚪ zależna od konfiguracji projektu Supabase | 📞 |
| Lokalizacja plików | Supabase Storage (ten sam projekt) | ✅ |
| Kopie zapasowe | Mechanizm Supabase (plan zależny) | 📞 |
| Wdrażanie nowych wersji | FE: push do repo → build (Vercel); DB: migracje SQL ręcznie/CLI | 🟡 |
| Zmienne środowiskowe | FE: `.env` (`VITE_*`); funkcje: sekrety Supabase | ✅ |
| Hasła/klucze | Anon key (FE), Service Role Key (funkcje) — w Supabase | ✅ |
| Porty / reguły sieciowe | Zarządzane (HTTPS 443) | 📞 |
| Ograniczenia | Zależność od dostępności Supabase/Vercel i internetu | ✅ |

**📞 Wymagane potwierdzenie od obecnego administratora/dostawcy:** właściciel konta Vercel i Supabase, region danych, plan i polityka backupów Supabase, konfiguracja domeny i DNS, ewentualne customowe ustawienia Auth (SMTP, szablony e-mail).

---

## 4. Wymagania dla serwerów firmowych

Założenie: **Wariant A — self-hosting Supabase** (Docker Compose: Postgres, GoTrue, PostgREST, Realtime, Storage, Kong API gateway, Studio) + serwowanie statycznego frontendu przez Nginx + reverse proxy.

### 4.1 Wariant MINIMALNY (testy/UAT)
| Zasób | Minimum |
|---|---|
| OS | Linux x86-64 (Ubuntu 22.04 LTS / Debian 12 / RHEL 9) |
| CPU | 4 vCPU |
| RAM | 8 GB |
| Dysk | 50 GB SSD (system + baza + pliki + obrazy Docker) |
| Rodzaj dysku | SSD (NVMe zalecane) |
| Baza | PostgreSQL 15+ (w stosie Supabase) |
| Serwer aplikacyjny | Docker + Docker Compose |
| Serwer WWW | Nginx (statyczny FE) |
| Reverse proxy | Nginx / Traefik |
| SSL | Let's Encrypt (wewn. CA dla sieci zamkniętej) |
| Backup | Codzienny dump bazy + snapshot wolumenu Storage |

### 4.2 Wariant PRODUKCYJNY (codzienne użytkowanie)
| Zasób | Zalecane |
|---|---|
| OS | Ubuntu 22.04 LTS / RHEL 9 (wsparcie firmowe) |
| CPU | 8 vCPU (rozdzielenie: app vs DB jeśli osobne hosty) |
| RAM | 16–32 GB |
| Dysk danych | 200 GB+ SSD NVMe, rozszerzalny (LVM/wolumen) |
| Wydajność dysku | ≥ 3000 IOPS dla wolumenu bazy |
| Baza danych | PostgreSQL 15+, na osobnym wolumenie, z WAL na szybkim dysku |
| Serwer plików | Wolumen Storage Supabase lub backend S3-kompatybilny (MinIO) |
| Serwer WWW | Nginx |
| Reverse proxy | Nginx/Traefik z terminacją TLS, nagłówki bezpieczeństwa |
| SSL | Certyfikat firmowy lub Let's Encrypt; TLS 1.2+ |
| Backup | Codzienny pełny + WAL (PITR), retencja wg sek. 14 |
| Monitoring | Prometheus + Grafana / Zabbix; alerty |
| Logi | Centralizacja (Loki/ELK/syslog) |

**Sieć / porty / firewall:** publicznie tylko 443 (HTTPS) przez reverse proxy; wewnętrznie porty usług Supabase (Kong 8000, Postgres 5432, Storage, Realtime) **niewystawiane na zewnątrz**. Dostęp z urządzeń mobilnych przez sieć firmową/VPN (patrz sek. 12).

---

## 5. Środowiska

Dane produkcyjne **nie mogą** być automatycznie kopiowane do środowiska testowego bez anonimizacji (RODO — dane osobowe operatorów: imię i nazwisko, RFID).

| Środowisko | Przeznaczenie | Baza | Wdrażanie | Backup | Zabezpieczenia | Oddzielenie danych |
|---|---|---|---|---|---|---|
| **DEV** | Rozwój, eksperymenty | Osobna instancja, dane syntetyczne | Lokalnie / CI z gałęzi `dev` | Opcjonalny | Podstawowe | Pełne odseparowanie |
| **TEST/UAT** | Testy odbiorowe, szkolenia | Osobna instancja, dane **zanonimizowane** | Z gałęzi `release` po przeglądzie | Tygodniowy | Jak prod (zmniejszone) | Odrębny host/sieć VLAN |
| **PROD** | Użytkowanie firmowe | Instancja produkcyjna | Z `main`, kontrolowane okno | Codzienny + PITR | Pełne (sek. 10) | Osobny host, dostęp ograniczony |

Dostęp: DEV — programiści; TEST — IT + wybrani użytkownicy biznesowi; PROD — użytkownicy końcowi wg ról + administratorzy IT.

---

## 6. Baza danych

| Cecha | Ustalenie | Status |
|---|---|---|
| Typ | PostgreSQL | ✅ |
| Wersja docelowa | 15+ (kompatybilna z Supabase) | ✅ |
| Liczba tabel | ~45 (z 42 plików migracji) | ✅ |
| Rozszerzenia | `uuid-ossp`, `pgcrypto` | ✅ |
| Triggery | Tak (np. auto-numer zgłoszeń TPM, `updated_at`, generatory numerów PM) | ✅ |
| Funkcje | Tak (RPC: `tpm_role`, `sa_get_my_role`, `tpm_mark_recurring`, `create_user_with_profile` i in.) | ✅ |
| Indeksy / ograniczenia | Tak (FK, CHECK, indeksy na kluczach obcych i statusach) | ✅ |
| RLS | Tak — na wszystkich tabelach modułów | ✅ |
| Audyt/historia | Tabele `audit_logs`, `tpm_issue_history`, `sa_audit_log` | ✅ |
| Zależność od `auth.users` | Tak — `profiles.id` → `auth.users(id)` (schemat Auth Supabase) | ✅ **kluczowe** |
| Liczba rekordów / rozmiar | ⚪ brak dostępu do produkcyjnej bazy | 📞 |
| Tempo przyrostu | ⚪ | 📞 |

**Funkcje zależne od środowiska Supabase (do odtworzenia):**
- Schemat `auth.*` (GoTrue) — konta, hasła (hash bcrypt), tożsamości. Migracje odwołują się do `auth.users` w **26 miejscach** — bez schematu Auth Supabase aplikacja nie zadziała.
- `storage.*` — bucket `failure-photos`.
- Publikacja `supabase_realtime` (16 odwołań) — tabele dodane do realtime.
- Role bazodanowe `authenticated`, `service_role`, `anon` (model Supabase) — granty w migracjach.

**Wnioski dot. migracji bazy:**
- Pełny eksport: ✅ możliwy (`pg_dump` całego klastra, w tym schematów `auth`, `storage`, `public`).
- Odtworzenie relacji, historii, audytu: ✅ przy dumpie pełnego klastra.
- Zachowanie kont użytkowników i haseł: ✅ **pod warunkiem** przeniesienia schematu `auth` (self-host Supabase) — wtedy konta i hashe haseł zostają, użytkownicy logują się bez resetu.
- Zachowanie załączników: zależne od osobnej migracji Storage (sek. 7).

### Procedura migracji bazy (skrót — pełna w sek. 19)
1. Zatrzymanie zapisów (okno serwisowe).
2. `pg_dump` pełnego klastra Supabase (schematy `public`, `auth`, `storage`, role, granty) — wymaga dostępu DB (📞 connection string / hasło od dostawcy).
3. Postawienie self-hosted Supabase (Docker) z PostgreSQL 15+.
4. Restore dumpa; weryfikacja rozszerzeń, RLS, triggerów, sekwencji.
5. Weryfikacja liczby rekordów per tabela (porównanie źródło↔cel).
6. Reindeksacja / `ANALYZE`.
7. Test logowania istniejącym kontem (potwierdza poprawność schematu `auth`).

---

## 7. Pliki, zdjęcia, załączniki

| Element | Ustalenie | Status |
|---|---|---|
| Lokalizacja | Supabase Storage, bucket `failure-photos` | ✅ |
| Typy | zdjęcia i filmy (awarie, AM/PM, parametry, jakość) | ✅ |
| Powiązanie z bazą | URL/ścieżki w kolumnach `photo_urls`, `*_photo_url` oraz tabela `tpm_media` | ✅ |
| Nazewnictwo | generowane: `<folder>/<timestamp>-<rand>.<ext>` | ✅ |
| Raporty/eksporty | **nie są przechowywane** — generowane on-the-fly po stronie klienta | ✅ |
| Całkowity rozmiar / przyrost | ⚪ brak dostępu do Storage | 📞 |
| Uprawnienia | bucket publiczny (publiczny URL do odczytu) | ✅ / ⚠ (sek. 10) |

**Ryzyko utraty powiązań:** URL-e plików zawierają domenę projektu Supabase. Po migracji domena Storage się zmieni → **istniejące URL-e w bazie staną się nieaktualne**, jeśli nie zachowamy tej samej ścieżki/hosta lub nie przepiszemy URL-i. Wymaga: migracji plików 1:1 (te same ścieżki w nowym buckecie) **oraz** ewentualnego skryptu aktualizującego bazowy host w kolumnach URL.

**Instrukcja przeniesienia plików:**
1. Eksport całego bucketu (`failure-photos`) z zachowaniem struktury katalogów (📞 dostęp do Storage).
2. Import do nowego Storage pod **identycznymi** ścieżkami.
3. Aktualizacja prefiksu hosta w URL-ach w bazie (jeśli zmienia się domena).
4. Weryfikacja: próbka N plików — czy każdy URL z bazy otwiera się i zgadza się z rekordem.

---

## 8. Zależności zewnętrzne

| Usługa | Cel | Połączenie | Dane | Klucze | Po migracji | Zamiennik lokalny | Ryzyko odłączenia |
|---|---|---|---|---|---|---|---|
| **Supabase Cloud** | Cała warstwa backend (DB/Auth/Realtime/Storage/Funcs) | HTTPS/WSS | wszystkie dane aplikacji | anon key + service role | Zastąpiona self-hostem Supabase | **Tak** (Supabase self-hosted) | Krytyczne — bez tego brak działania |
| **Vercel** | Hosting statycznego frontendu | HTTPS | tylko pliki statyczne | — | Zastąpiony Nginx | Tak | Niskie (łatwa zamiana) |
| **Microsoft Teams (webhook)** | Powiadomienia o awariach | HTTPS POST (wychodzące) | treść alertu | URL webhooka (`VITE_TEAMS_WEBHOOK_URL`) | Możliwe zachowanie lub wyłączenie | Tak (SMTP/inny kanał) | Niskie (opcjonalne) |
| **cdnjs / Cloudflare (ExcelJS)** | Generowanie XLSX w przeglądarce | HTTPS GET (CDN) | brak | — | **Wymaga lokalnego hostowania** w sieci zamkniętej | Tak (paczka npm/lokalny plik) | Średnie — bez internetu eksport XLSX nie zadziała |

**Brak** wykrytych integracji: zewnętrzna baza inna niż Supabase, SMS, mapy, analityka, płatności, zewnętrzny generator PDF. ✅

---

## 9. Zmienne środowiskowe i dane dostępowe

**Wartości haseł/kluczy NIE są ujawniane w tym raporcie.** W repozytorium plik `.env` zawiera tylko 2 zmienne frontendowe (brak `.env.example`).

| Zmienna | Przeznaczenie | Środowisko | Obowiązkowa | Źródło |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Adres API Supabase | Frontend (build) | ✅ Tak | Panel Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Klucz publiczny (anon) klienta | Frontend (build) | ✅ Tak | Panel Supabase → Settings → API |
| `VITE_TEAMS_WEBHOOK_URL` | Webhook powiadomień Teams | Frontend (build) | ⚪ Nie (opcjonalna) | Konfiguracja kanału Teams |
| `SUPABASE_URL` | Adres API dla funkcji brzegowych | Edge Functions | ✅ Tak | Środowisko Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY` | Klucz serwisowy (pełne uprawnienia) | Edge Functions | ✅ Tak | Panel Supabase (tajny) |

**📞 Do przekazania przez obecnego dostawcę:** wartości service role key, konfiguracja Auth (SMTP, redirect URL), URL webhooka Teams, ewentualne dodatkowe sekrety funkcji.

> **Uwaga bezpieczeństwa:** zmienne `VITE_*` są wkompilowywane do frontendu i **publiczne** z założenia (anon key jest publiczny — bezpieczeństwo opiera się na RLS). Service role key jest tajny i używany wyłącznie w funkcjach brzegowych — nigdy w przeglądarce. ✅ kod przestrzega tej zasady.

---

## 10. Bezpieczeństwo — analiza i ryzyka

| Obszar | Stan w kodzie | Status |
|---|---|---|
| Przechowywanie haseł | bcrypt w GoTrue (Supabase Auth) | ✅ |
| Szyfrowanie komunikacji | HTTPS/WSS | ✅ |
| SSL | zarządzany (do odtworzenia w firmie) | 🟡 |
| Sesje | JWT w `sessionStorage`, auto-refresh, wygaszanie z tokenem | ✅ |
| Kontrola dostępu | RLS w bazie + role w `profiles` + `RequireAuth` w routingu | ✅ |
| Zabezpieczenie API | JWT + RLS (egzekwowane w bazie, nie tylko w UI) | ✅ |
| SQL Injection | parametryzowane zapytania przez PostgREST/supabase-js | ✅ |
| XSS | React escapuje domyślnie; raporty PDF używają własnej funkcji `esc()` | ✅ 🟡 |
| CSRF | model token-bearer (brak ciasteczek sesyjnych) ogranicza CSRF | ✅ |
| Logowanie zdarzeń | `audit_logs`, `*_history` | ✅ |

### Rejestr ryzyk bezpieczeństwa

| # | Ryzyko | Poziom | Sposób usunięcia przed PROD |
|---|---|---|---|
| B1 | **Bucket plików publiczny** (`failure-photos`) — zdjęcia awarii/jakości dostępne przez znający URL | **Wysoki** | Zmiana na bucket prywatny + signed URLs; ograniczenie dostępu w nowym Storage |
| B2 | **Brak wymuszonego MFA** dla kont admin/manager | **Wysoki** | Włączyć MFA w Auth (Supabase wspiera TOTP) dla ról uprzywilejowanych |
| B3 | **Brak limitów prób logowania / rate-limiting** widocznego w kodzie | **Średni** | Konfiguracja rate-limit w GoTrue / reverse proxy (fail2ban, limity Nginx) |
| B4 | **ExcelJS z publicznego CDN** — zależność zewnętrzna i wektor dostępu | **Średni** | Hostować ExcelJS lokalnie (paczka npm/własny statyk) |
| B5 | **Webhook Teams w zmiennej frontendowej** — URL publiczny w buildzie | **Średni** | Przenieść powiadomienia do funkcji serwerowej; URL jako sekret |
| B6 | **Brak nagłówków bezpieczeństwa** (CSP/HSTS) zależny od hostingu | **Średni** | Skonfigurować w reverse proxy (CSP, HSTS, X-Frame-Options) |
| B7 | **`sessionStorage`** — sesja per karta; ryzyko XSS odczytujące token | **Niski** | Utrzymać CSP; rozważyć krótszy TTL tokenu |
| B8 | **Bezpieczeństwo backupów** (szyfrowanie spoczynkowe) | **Średni** | Szyfrować dumpy i snapshoty (sek. 14) |

---

## 11. Użytkownicy i logowanie

| Pytanie | Odpowiedź | Status |
|---|---|---|
| Gdzie konta | schemat `auth.users` (Supabase) + profil w `public.profiles` | ✅ |
| Jak hasła | hash bcrypt (GoTrue) | ✅ |
| Role | kolumna `profiles.role` (enum 7 ról) + RLS | ✅ |
| Tworzenie użytkownika | funkcja `admin-create-user` (service role) + RPC `create_user_with_profile` | ✅ |
| Reset hasła | mechanizm Supabase Auth + flaga `must_change_password` | ✅ 🟡 |
| Blokada konta | `is_active=false` / `deleted_at` (soft-delete) | ✅ |
| Wylogowanie | `supabase.auth.signOut` (lokalny zakres) | ✅ |
| MFA | brak w kodzie; możliwe do włączenia w Auth | 🟡 |
| Integracja z Active Directory / Entra ID | brak w kodzie | ⚪ — możliwa do dodania (GoTrue SAML/OIDC) wymaga przebudowy logowania |
| Własny mechanizm logowania | Tak — RFID (`rfid-login`) na bazie tokenów Auth | ✅ |

**Zachowanie kont po migracji:** ✅ **Tak**, bez tworzenia od nowa — pod warunkiem przeniesienia schematu `auth` w dumpie (Wariant A). Hasła (hashe) i powiązania `profiles↔auth.users` zostają nienaruszone.

---

## 12. Sieć i dostęp

| Pytanie | Rekomendacja |
|---|---|
| Sieć firmowa / internet | Domyślnie: dostęp z sieci firmowej; dostęp zewnętrzny tylko przez VPN |
| VPN | Tak — dla pracy zdalnej i wsparcia IT |
| Tablety/telefony na produkcji | Tak — przez firmowe Wi-Fi/VLAN produkcyjny |
| Wymagane porty | publiczny tylko 443 (reverse proxy); wewnętrzne usługi Supabase nieeksponowane |
| Połączenia wychodzące | Teams webhook (opcjonalnie), CDN ExcelJS (do zlokalizowania) |
| Stały internet | **Nie** dla rdzenia po self-hoście; **Tak** jeśli zostają Teams/CDN |
| Izolacja od internetu | Możliwa po: zlokalizowaniu ExcelJS i wyłączeniu/wewn. webhooka |
| DNS | Wystarczy **wewnętrzny DNS** dla dostępu wyłącznie firmowego; publiczny DNS tylko przy dostępie z zewnątrz |

**Model dostępu:**
- **Komputery firmowe:** bezpośrednio w LAN, HTTPS.
- **Tablety na produkcji:** VLAN produkcyjny, PWA zainstalowana, landscape.
- **Telefony:** Wi-Fi firmowe lub VPN.
- **Zdalne wsparcie IT:** VPN + dostęp administracyjny do hostów.
- **Użytkownicy poza zakładem:** wyłącznie VPN (lub publikacja przez reverse proxy z MFA — decyzja bezpieczeństwa).

---

## 13. Wydajność i skalowanie

⚪ Brak danych o realnym ruchu (wymaga pomiaru/dostępu). Szacunek na podstawie charakteru (MES, kilka linii):

- Liczba użytkowników: ⚪ — *Wymaga dodatkowej analizy* (liczba operatorów × zmiany).
- Jednoczesność: prawdopodobnie kilkudziesięciu (Realtime per stacja/sesja).
- Wąskie gardła potencjalne: (a) Realtime przy wielu subskrypcjach, (b) zapytania dashboardów agregujące duże zakresy, (c) Storage przy filmach.
- Cache: React Query po stronie klienta + Workbox; serwerowy cache zbędny na start.
- Kolejka zadań: obecnie brak; przy rozbudowie powiadomień/raportów serwerowych — rozważyć.
- Osobny serwer plików: zalecany przy dużym wolumenie filmów (MinIO/S3).
- Osobny serwer bazy: zalecany w PROD (rozdzielenie DB od usług app).

**Minimalna wydajność:** sek. 4.1. **Zalecana:** sek. 4.2. Skalowanie pionowe (więcej RAM/CPU dla Postgres) jako pierwszy krok; poziome (repliki odczytu) tylko przy realnej potrzebie.

---

## 14. Kopie zapasowe i odtwarzanie

| Element | Częstotliwość | Retencja | Miejsce | Szyfrowanie | Test |
|---|---|---|---|---|---|
| Baza (pełny dump) | Codziennie | 30 dni | Repozytorium backup firmowe + offsite | Tak | Miesięczny restore testowy |
| Baza (WAL/PITR) | Ciągłe | 7 dni | Szybki storage | Tak | Kwartalny PITR |
| Pliki (Storage) | Codziennie (przyrostowo) | 30 dni | Backup firmowy | Tak | Miesięczny |
| Konfiguracja / `.env` / sekrety | Przy każdej zmianie | Wersjonowane | Sejf haseł (Vault/KeePass firmowy) | Tak | — |
| Certyfikaty | Przy odnowieniu | Do wygaśnięcia +1 | Sejf | Tak | — |
| Kod aplikacji | Wersjonowany w Git | Pełna historia | Repozytorium firmowe | — | — |
| Logi | Rotacja | 90 dni (lub wg polityki) | Centralny log | Wg polityki | — |

**Rekomendowane:** **RPO ≤ 24 h** (z PITR ≤ 15 min dla bazy), **RTO ≤ 4 h**. Procedura awaryjna: odtworzenie hostów z obrazów/Docker → restore bazy (pełny + WAL) → restore Storage → weryfikacja logowania i próbki danych → przełączenie ruchu.

---

## 15. Monitoring i logi

**Monitorować:** dostępność (health-check HTTP), czas odpowiedzi, CPU/RAM/dysk, stan Postgres (połączenia, locki, replikacja), błędy aplikacji (FE — np. Sentry; BE — logi usług), błędy logowania (GoTrue), błędy API (Kong/PostgREST), liczba aktywnych sesji, nieudane zadania (RPC), brak miejsca na dysku, niewykonane backupy, wygasające certyfikaty.

- **Logi → gdzie:** centralny zbiór (Loki/ELK/syslog firmowy).
- **Retencja:** 90 dni (logi techniczne); audyt aplikacyjny — w bazie (bezterminowo wg polityki).
- **Dostęp:** wyłącznie IT/administratorzy.
- **Alerty:** niedostępność > 2 min, dysk > 85%, backup nieudany, certyfikat < 14 dni, skok błędów 5xx, nietypowy wzrost nieudanych logowań.

---

## 16. Sposób wdrażania

**Obecnie (🟡):** FE budowany z repo i hostowany na Vercel; migracje DB uruchamiane ręcznie w SQL Editor / `supabase db push`.

**Docelowo (rekomendacja):**
- **Repozytorium:** firmowy Git (GitLab/Azure DevOps), gałęzie `main` (prod), `release` (test), `dev`.
- **Budowanie:** CI buduje statyczny FE (`npm ci && npm run build`), artefakt → obraz/Nginx.
- **Testy:** `npm run typecheck`, `npm run lint`, testy odbiorowe (sek. 20).
- **Migracje bazy:** wersjonowane pliki `supabase/migrations/*` uruchamiane w kontrolowanej kolejności (CLI Supabase / skrypt psql) w oknie serwisowym.
- **Wdrożenie BE:** stos Supabase przez **Docker Compose** (Postgres, GoTrue, PostgREST, Realtime, Storage, Kong, Studio).
- **Konfiguracja:** sekrety z firmowego Vault; `.env` per środowisko.
- **Restart/rollback:** `docker compose up -d`; rollback = poprzedni obraz FE + przywrócenie zrzutu bazy.
- **Rejestr wdrożeń:** changelog + tagi Git + log migracji w bazie.

**Wybór technologii uruchomienia:**
| Opcja | Ocena dla Margomedu |
|---|---|
| **Docker Compose** | ✅ **Rekomendowane** — Supabase dostarcza oficjalny compose; jeden serwer; proste utrzymanie |
| Kubernetes | Możliwe, ale nadmiarowe dla skali jednego zakładu; większa złożoność operacyjna |
| Usługi systemowe (bez kontenerów) | Trudne — Supabase to wiele usług; ręczna instalacja ryzykowna |

**Uzasadnienie:** Docker Compose odwzorowuje architekturę Supabase 1:1, minimalizuje zmiany w kodzie, jest wspierany oficjalnie i wystarczający dla skali zakładowej. Kubernetes rozważyć dopiero przy wielu zakładach/HA.

---

## 17. Licencje i własność

| Element | Do ustalenia | Status |
|---|---|---|
| Kod źródłowy | właściciel praw (umowa z twórcą) | 📞 |
| Baza danych (dane) | własność Margomed (dane produkcyjne) | 🟡 |
| Domena | rejestrator i właściciel | 📞 |
| Certyfikaty | wystawca/właściciel | 📞 |
| Konta usług (Supabase/Vercel) | na kogo zarejestrowane | 📞 |
| Klucze API | w gestii właściciela konta | 📞 |
| Biblioteki | open-source (MIT/Apache/ISC — React, Vite, Tailwind, Radix, Supabase JS, ExcelJS) | ✅ brak opłat licencyjnych |
| Supabase | open-source (self-host bez opłaty licencyjnej; chmura płatna wg planu) | ✅/📞 |
| Ograniczenia prawne | RODO (dane osobowe operatorów) | 🟡 |

**Do formalnego przekazania:** własność/licencja kodu, konta Supabase i Vercel (lub eksporty), domena, certyfikaty, klucze.

---

## 18. Checklista materiałów od obecnego dostawcy

- [ ] Pełny kod źródłowy + dostęp do repozytorium + historia wersji 📞
- [ ] Dokumentacja techniczna i instrukcja uruchomienia 📞
- [ ] Lista technologii i wersji (✅ w tym raporcie — do potwierdzenia)
- [ ] Pliki konfiguracyjne wszystkich środowisk 📞
- [ ] **Komplet zmiennych środowiskowych z wartościami** (w tym service role key, webhook) 📞
- [ ] **Pełny eksport bazy** (`pg_dump` klastra: `public`+`auth`+`storage`+role) 📞 — krytyczne
- [ ] Schemat bazy (jest w migracjach ✅)
- [ ] **Kopia wszystkich plików ze Storage** (`failure-photos`) 📞 — krytyczne
- [ ] Lista integracji (✅ w raporcie) + klucze/tokeny 📞
- [ ] Certyfikaty SSL 📞
- [ ] Konfiguracja DNS i dostęp do domeny 📞
- [ ] Konfiguracja Auth/SMTP (szablony, redirecty) 📞
- [ ] Konta administracyjne (Supabase, Vercel) 📞
- [ ] Instrukcja backupu/odtwarzania stosowana obecnie 📞
- [ ] Lista znanych błędów i niedokończonych funkcji 📞

---

## 19. Plan migracji (etapy)

**Etap 1 — Inwentaryzacja:** analiza kodu (✅ wykonana w tym raporcie), pozyskanie dostępów (📞), eksport bazy i plików, lista braków.
**Etap 2 — Przygotowanie środowiska:** serwery + OS, Docker, stos Supabase, reverse proxy, SSL, DNS (wewn./zewn.), firewall, monitoring, backup.
**Etap 3 — Migracja testowa (TEST/UAT):** wdrożenie FE, restore bazy, import plików (te same ścieżki), konfiguracja sekretów, uruchomienie, weryfikacja.
**Etap 4 — Testy:** wg checklisty sek. 20 (logowanie, role, formularze, zapisy, raporty, pliki, wydajność, bezpieczeństwo).
**Etap 5 — Migracja produkcyjna:** okno serwisowe → stop zapisów → backup końcowy → eksport końcowy → import → uruchomienie → weryfikacja → przełączenie DNS → potwierdzenie.
**Etap 6 — Stabilizacja:** monitoring, poprawki, wsparcie użytkowników, kontrola backupów, dokumentacja końcowa.

---

## 20. Testy po migracji (checklista odbiorowa)

Dla każdego testu: *warunki / kroki / oczekiwany wynik / wynik rzeczywisty / status (zalicz/niezalicz)*. Wynik rzeczywisty i status uzupełnia IT podczas testów.

| # | Test | Oczekiwany wynik |
|---|---|---|
| T1 | Logowanie e-mail/hasło | Dostęp wg roli |
| T2 | Logowanie RFID | Token i sesja poprawne |
| T3 | Wylogowanie | Sesja zakończona |
| T4 | Reset / wymuszona zmiana hasła | Nowe hasło działa |
| T5 | Role (5 typów kont) | Widoczność/akcje zgodne z RLS |
| T6 | Uprawnienia (próba akcji bez prawa) | Odmowa (RLS) |
| T7 | Tworzenie danych (checklista AM/zmiana SA) | Zapis w bazie |
| T8 | Edycja danych | Zapis + wpis w historii |
| T9 | Odczyt/listy/filtry | Dane poprawne |
| T10 | Upload zdjęcia | Plik w Storage + URL w bazie |
| T11 | Upload filmu | Odtwarzalny |
| T12 | Raporty (Pareto, raport mies./SA) | Liczby zgodne |
| T13 | Eksport XLSX | Plik pobrany (ExcelJS dostępny lokalnie) |
| T14 | Eksport PDF (druk) | Dokument poprawny |
| T15 | Eksport CSV | Poprawne kodowanie PL |
| T16 | Powiadomienia wewnętrzne | Klikalne, prowadzą do rekordu |
| T17 | Powiadomienie Teams (jeśli włączone) | Dostarczone |
| T18 | Dashboard + drill-down | Filtry działają |
| T19 | Realtime (panel nadzorczy) | Odświeżanie na żywo |
| T20 | Telefon / tablet / komputer | Responsywność OK |
| T21 | Wydajność (typowe obciążenie) | Czasy odpowiedzi akceptowalne |
| T22 | Bezpieczeństwo (nagłówki, HTTPS, RLS) | Brak luk krytycznych |
| T23 | Backup | Wykonany i kompletny |
| T24 | Odtworzenie z backupu | Pełne, spójne dane |

---

## 21. Rejestr ryzyk migracji

| # | Ryzyko | Prawd. | Wpływ | Poziom | Ograniczenie | Plan awaryjny | Odpowiedzialny |
|---|---|---|---|---|---|---|---|
| R1 | Brak pełnego dostępu do bazy/plików od dostawcy | Średnie | Krytyczny | **Krytyczny** | Formalne pozyskanie dostępów (sek. 18) przed startem | Wstrzymanie migracji | IT + Zarząd |
| R2 | Utrata powiązań plik↔baza (zmiana hosta URL) | Średnie | Wysoki | **Wysoki** | Te same ścieżki + skrypt aktualizacji URL | Odtworzenie z backupu | IT |
| R3 | Schemat `auth` niespójny po restore (utrata kont) | Niskie | Krytyczny | **Wysoki** | Dump pełnego klastra, test logowania w TEST | Reset haseł / odtworzenie | IT + twórca |
| R4 | ExcelJS z CDN niedostępny w sieci zamkniętej | Wysokie | Średni | **Średni** | Zlokalizować ExcelJS (przebudowa drobna) | XLSX wyłączony tymczasowo | Twórca |
| R5 | Niezgodność wersji PostgreSQL/rozszerzeń | Niskie | Wysoki | **Średni** | PostgreSQL 15+ jak Supabase; test w TEST | Dopasowanie wersji | IT |
| R6 | Powiadomienia Teams nie działają | Średnie | Niski | **Niski** | Rekonfiguracja webhooka / kanał alternatywny | Powiadomienia wewn. | IT |
| R7 | Problemy z certyfikatem/DNS przy przełączeniu | Średnie | Wysoki | **Wysoki** | Przygotować cert i DNS w TEST, TTL DNS w dół | Powrót DNS do starego | IT |
| R8 | Przestój podczas cięcia | Średnie | Wysoki | **Wysoki** | Okno serwisowe, próba na TEST | Rollback wg sek. 22 | IT |
| R9 | Niezgodne uprawnienia/RLS po migracji | Niskie | Wysoki | **Średni** | Testy ról (T5/T6) | Korekta polityk | Twórca |
| R10 | Zbyt mała wydajność serwera | Średnie | Średni | **Średni** | Wariant produkcyjny (sek. 4.2), monitoring | Skalowanie pionowe | IT |
| R11 | Brak możliwości powrotu do starego środowiska | Niskie | Krytyczny | **Wysoki** | Utrzymać stare środowisko „read-only" przez okres stabilizacji | Przełączenie DNS wstecz | IT + Zarząd |
| R12 | Dane osobowe w środowisku TEST bez anonimizacji | Średnie | Wysoki (RODO) | **Wysoki** | Anonimizacja przed kopią do TEST | Wstrzymanie kopii | IT + IOD |

---

## 22. Raport końcowy dla IT

1. **Architektura:** SPA React (Vercel) + Supabase (DB/Auth/Realtime/Storage/Funcs). Patrz sek. 2.
2. **Diagram:** sek. 2.1.
3. **Technologie:** sek. 2.2.
4. **Zależności:** Supabase (krytyczna), Vercel, Teams, CDN ExcelJS. Sek. 8.
5. **Usługi zewnętrzne:** sek. 8.
6. **Baza:** PostgreSQL, ~45 tabel, RLS, triggery, funkcje, zależność od `auth`/`storage`. Sek. 6.
7. **Pliki:** Supabase Storage `failure-photos` (publiczny). Sek. 7.
8. **Wymagania minimalne:** sek. 4.1.
9. **Wymagania produkcyjne:** sek. 4.2.
10. **Sieć:** 443 publicznie, reszta wewnętrznie, VPN dla zdalnych. Sek. 12.
11. **Bezpieczeństwo:** RLS mocną stroną; ryzyka B1–B8. Sek. 10.
12. **Backup:** RPO ≤ 24 h (PITR ≤ 15 min), RTO ≤ 4 h. Sek. 14.
13. **Monitoring:** dostępność, zasoby, Postgres, błędy, backupy, certyfikaty. Sek. 15.
14. **Do przekazania przez dostawcę:** sek. 18 (krytyczne: dump bazy, pliki, sekrety, dostępy).
15. **Do przebudowy:** lokalny ExcelJS (R4/B4), bucket prywatny (B1), webhook serwerowy (B5), opcjonalnie MFA/AD (sek. 11).
16. **Ryzyka:** sek. 21.
17. **Plan migracji:** sek. 19.
18. **Plan testów:** sek. 20.
19. **Procedura powrotu:** utrzymać stare środowisko w trybie read-only; rollback = przywrócenie poprzedniego buildu FE + przełączenie DNS na stary backend + (jeśli były zapisy) zrzut różnicowy. Decyzja go/no-go po Etapie 4.
20. **Rekomendacja końcowa:** sek. 25.

---

## 23. Tabela podsumowująca prace

| Obszar | Obecny stan | Co trzeba zrobić | Priorytet | Zależności | Ryzyko |
|---|---|---|---|---|---|
| Kod aplikacji | ✅ w repo | Pozyskać własność/licencję, przenieść do Git firmowego | Wysoki | Dostawca | R1 |
| Frontend | SPA na Vercel | Build + hosting Nginx | Średni | — | Niskie |
| Backend | Supabase Cloud | Self-host Supabase (Docker) | Krytyczny | Dump, sekrety | R1,R3 |
| Baza danych | PostgreSQL (Supabase) | Eksport klastra + restore + weryfikacja | Krytyczny | Dostęp DB | R1,R3,R5 |
| Pliki | Storage publiczny | Eksport + import 1:1 + prywatyzacja | Wysoki | Dostęp Storage | R2,B1 |
| Logowanie | Supabase Auth | Przenieść schemat `auth`; rozważyć MFA | Krytyczny | Dump auth | R3,B2 |
| Role | RLS + `profiles` | Testy ról po migracji | Wysoki | Baza | R9 |
| API | PostgREST/Realtime | Uruchomić w stosie Supabase | Krytyczny | Backend | R8 |
| Integracje | Teams, CDN ExcelJS | Webhook serwerowy; ExcelJS lokalnie | Średni | — | R4,R6 |
| Serwer | brak (zarządzane) | Przygotować hosty (sek. 4) | Krytyczny | Sprzęt | R10 |
| Sieć | zarządzana | Firewall, VLAN, VPN | Wysoki | Infra | R7 |
| DNS | zewn. (zarządzane) | Wewn. lub publ. DNS | Wysoki | Infra | R7 |
| SSL | automatyczny | Cert firmowy/Let's Encrypt | Wysoki | DNS | R7 |
| Backup | Supabase | Wdrożyć plan sek. 14 | Krytyczny | Infra | R1 |
| Monitoring | ⚪ | Wdrożyć sek. 15 | Wysoki | Infra | — |
| Bezpieczeństwo | RLS ok; luki B1–B8 | Usunąć ryzyka przed PROD | Wysoki | — | B1–B8 |
| Dokumentacja | częściowa | Uzupełnić (uruchomienie, backup) | Średni | Dostawca | R1 |
| Testy | ⚪ | Wykonać sek. 20 | Wysoki | Środowisko TEST | R8 |

---

## 24. Szacowanie złożoności

| Obszar | Złożoność | Wykonawca |
|---|---|---|
| Self-host Supabase (Docker) | **Duża** | IT (z dokumentacją Supabase) + ewent. twórca |
| Migracja bazy (dump/restore + auth/storage) | **Krytyczna** | IT + twórca (weryfikacja RLS/triggerów) |
| Migracja plików + prywatyzacja bucketu | **Średnia** | IT |
| Hosting frontendu (Nginx) + reverse proxy/SSL | **Średnia** | IT |
| Lokalizacja ExcelJS (drobna przebudowa) | **Mała** | Twórca |
| Webhook Teams → funkcja serwerowa | **Mała** | Twórca |
| MFA / integracja AD/Entra ID | **Duża** | Twórca (przebudowa logowania) |
| Sieć/firewall/VPN/DNS | **Średnia** | IT |
| Backup + monitoring + alerty | **Średnia** | IT |
| Testy odbiorowe | **Średnia** | IT + użytkownicy |
| Pozyskanie własności kodu/dostępów | **Wymaga dodatkowej analizy** | Zarząd + dział prawny |
| Pomiar realnego ruchu/rozmiaru danych | **Wymaga dodatkowej analizy** | IT (po uzyskaniu dostępu) |

---

## 25. Zasady analizy i rekomendacja końcowa

**Czego nie zakładamy:** aplikacji **nie da się** po prostu „skopiować na serwer". „Backend" to platforma Supabase — migracja oznacza odtworzenie tej platformy (Wariant A) lub jej zastąpienie (Wariant B).

**Status weryfikacji elementów:**
- ✅ Potwierdzone: stos technologiczny, struktura bazy (migracje), mechanizm Auth/RLS, magazyn plików, integracje, zmienne FE.
- 🟡 Częściowo: hosting (Vercel/Supabase Cloud), SSL/DNS, sposób wdrażania, backupy.
- ⚪ Niezweryfikowane: rozmiar bazy/plików, realny ruch, liczba rekordów.
- 📞 Od dostawcy: dostęp do bazy/Storage/kont, sekrety, własność kodu, DNS/cert.

**Rekomendacja końcowa:**
1. **Decyzja strategiczna:** przyjąć **Wariant A — self-hosting Supabase na Docker Compose**. Zachowuje funkcjonalność, role, historię, konta i hashe haseł przy minimum zmian w kodzie.
2. **Warunek wejścia:** najpierw pozyskać od obecnego dostawcy komplet z sek. 18 (krytyczne: pełny dump klastra, kopia Storage, sekrety, dostępy, własność kodu). Bez tego migracja nie powinna ruszać (R1).
3. **Kolejność:** Inwentaryzacja → środowisko TEST → migracja testowa → testy odbiorowe → migracja produkcyjna w oknie serwisowym → stabilizacja, ze starym środowiskiem utrzymanym „read-only" jako ścieżka powrotu (R11).
4. **Przed PROD usunąć:** B1 (prywatny bucket), B4 (lokalny ExcelJS), rozważyć B2 (MFA dla adminów), B5/B6 (webhook serwerowy, nagłówki bezpieczeństwa).
5. **Zaangażowanie twórcy aplikacji** wymagane dla: weryfikacji RLS/triggerów po restore, lokalizacji ExcelJS, ewentualnego MFA/AD. Reszta po stronie IT.

---

*Dokument przygotowany na podstawie analizy repozytorium kodu. Pozycje 📞/⚪ wymagają danych spoza repozytorium przed finalną wyceną i harmonogramem.*
