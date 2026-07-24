<#
Synchronizuje zdjecia statystyk zmianowych (shift_stat_photos) z Margoline do
lokalnego folderu zsynchronizowanego z SharePoint przez OneDrive. Uruchamiany
cyklicznie (Harmonogram zadan Windows) - kazde uruchomienie loguje sie na
koncie technicznym, pobiera liste zdjec i zapisuje TYLKO te, ktorych jeszcze
nie ma na dysku (rozpoznawane po nazwie pliku - stan trzymany na dysku, bez
osobnej bazy stanu).

Wymaga pliku sync-config.json obok tego skryptu - skopiuj
sync-config.example.json, zmien nazwe i uzupelnij haslo konta technicznego
oraz sciezke docelowego folderu.
#>

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'sync-config.json'
$logPath = Join-Path $scriptDir 'sync-log.txt'

function Write-Log {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Output $line
    Add-Content -Path $logPath -Value $line -Encoding utf8
}

# Windows PowerShell 5.1 domyslnie NIE pokazuje tresci odpowiedzi serwera przy
# bledzie HTTP (Invoke-RestMethod rzuca tylko ogolny "(400) Zle zadanie") -
# trzeba recznie odczytac strumien odpowiedzi z wyjatku, zeby zobaczyc
# prawdziwy powod (np. "Invalid login credentials").
function Get-ErrorResponseBody {
    param($ErrorRecord)
    $resp = $ErrorRecord.Exception.Response
    if (-not $resp) { return $null }
    try {
        $stream = $resp.GetResponseStream()
        $stream.Position = 0
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return $null
    }
}

if (-not (Test-Path $configPath)) {
    Write-Log "BLAD: brak pliku sync-config.json obok skryptu. Skopiuj sync-config.example.json, zmien nazwe na sync-config.json i uzupelnij dane."
    exit 1
}

try {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $supabaseUrl = $config.supabaseUrl.TrimEnd('/')
    $anonKey = $config.anonKey
    $email = $config.email
    $password = $config.password
    $targetFolder = $config.targetFolder

    if (-not (Test-Path $targetFolder)) {
        New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
    }

    if ([string]::IsNullOrWhiteSpace($password) -or $password -eq 'WKLEJ_TU_HASLO_KONTA_TECHNICZNEGO') {
        throw "W sync-config.json pole 'password' nie zostalo uzupelnione (wciaz jest placeholder). Wklej tam prawdziwe haslo konta technicznego."
    }

    Write-Log "Logowanie jako $email..."
    $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
    $loginHeaders = @{ apikey = $anonKey; 'Content-Type' = 'application/json' }
    try {
        $loginResp = Invoke-RestMethod -Uri "$supabaseUrl/auth/v1/token?grant_type=password" -Method Post -Headers $loginHeaders -Body $loginBody
    } catch {
        $detail = Get-ErrorResponseBody -ErrorRecord $_
        throw "Logowanie nie powiodlo sie ($($_.Exception.Message)). Odpowiedz serwera: $detail"
    }
    $accessToken = $loginResp.access_token
    if (-not $accessToken) { throw "Logowanie nie zwrocilo tokenu - sprawdz email/haslo w sync-config.json." }

    $headers = @{ apikey = $anonKey; Authorization = "Bearer $accessToken" }

    Write-Log "Pobieranie listy zdjec..."
    $selectQuery = [uri]::EscapeDataString('*,machine:machines(name)')
    $listUri = "$supabaseUrl/rest/v1/shift_stat_photos?select=$selectQuery&order=captured_at.desc&limit=1000"
    try {
        $photos = Invoke-RestMethod -Uri $listUri -Headers $headers -Method Get
    } catch {
        $detail = Get-ErrorResponseBody -ErrorRecord $_
        throw "Pobieranie listy zdjec nie powiodlo sie ($($_.Exception.Message)). Odpowiedz serwera: $detail"
    }

    $newCount = 0
    $skipCount = 0
    $errorCount = 0

    foreach ($photo in $photos) {
        $captured = [datetime]$photo.captured_at
        $hh = $captured.ToString('HH')
        $mm = $captured.ToString('mm')
        $machineName = if ($photo.machine -and $photo.machine.name) { $photo.machine.name } else { 'automat' }
        $machineNameSafe = ($machineName -replace '[^\w\-]+', '-')
        $moduleSuffix = if ($photo.module_key) { "_$($photo.module_key)" } else { '' }
        $shiftDate = $photo.shift_date
        if (-not $shiftDate) { $shiftDate = $captured.ToString('yyyy-MM-dd') }

        # Struktura: {folder}\RRRR\MM\DD\plik.jpg
        $dateFolder = Join-Path $targetFolder ($shiftDate.Substring(0, 4))
        $dateFolder = Join-Path $dateFolder ($shiftDate.Substring(5, 2))
        $dateFolder = Join-Path $dateFolder ($shiftDate.Substring(8, 2))
        if (-not (Test-Path $dateFolder)) { New-Item -ItemType Directory -Path $dateFolder -Force | Out-Null }

        $fileName = "${shiftDate}_Zmiana-$($photo.shift_type)_${machineNameSafe}${moduleSuffix}_$hh-$mm.jpg"
        $filePath = Join-Path $dateFolder $fileName

        if (Test-Path $filePath) {
            $skipCount++
            continue
        }

        try {
            $signBody = @{ expiresIn = 3600 } | ConvertTo-Json
            $signUri = "$supabaseUrl/storage/v1/object/sign/shift-stats-photos/$($photo.photo_path)"
            $signResp = Invoke-RestMethod -Uri $signUri -Headers $headers -Method Post -Body $signBody -ContentType 'application/json'
            $downloadUrl = "$supabaseUrl/storage/v1$($signResp.signedURL)"
            Invoke-WebRequest -Uri $downloadUrl -Headers @{ apikey = $anonKey } -OutFile $filePath
            $newCount++
            Write-Log "Zapisano: $shiftDate\$fileName"
        } catch {
            $errorCount++
            $detail = Get-ErrorResponseBody -ErrorRecord $_
            Write-Log "BLAD przy pobieraniu $fileName : $($_.Exception.Message) $(if ($detail) { "| $detail" })"
        }
    }

    Write-Log "Zakonczono. Nowe: $newCount, pominiete (juz byly): $skipCount, bledy: $errorCount, sprawdzonych lacznie: $($photos.Count)."
} catch {
    Write-Log "BLAD KRYTYCZNY: $($_.Exception.Message)"
    exit 1
}
