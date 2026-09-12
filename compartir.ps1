# Publica el curso en internet con un tunel de Cloudflare.
# Uso:  powershell -ExecutionPolicy Bypass -File compartir.ps1
# Ctrl+C para detener todo.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$port = if ($env:PORT) { $env:PORT } else { 3000 }

Write-Host "Arrancando el servidor (npm start) en el puerto $port..." -ForegroundColor Cyan
$server = Start-Process -FilePath "npm" -ArgumentList "start" -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "Abriendo el tunel de Cloudflare..." -ForegroundColor Cyan
Write-Host "La URL publica https://xxxx.trycloudflare.com aparece abajo en unos segundos." -ForegroundColor Yellow
Write-Host ""

try {
    & "$PSScriptRoot\tools\cloudflared.exe" tunnel --url "http://localhost:$port"
}
finally {
    Write-Host "`nCerrando el servidor..." -ForegroundColor Cyan
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
