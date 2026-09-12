# Arranca el servidor de "La ruta del ingles" solo si el puerto 3000 no responde.
# Pensado para ejecutarse cada hora desde el Programador de tareas de Windows.
$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot           # E:\LearningEnglish
$log  = Join-Path $root 'keepalive.log'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  "$stamp  OK - ya en marcha (PID $($listening[0].OwningProcess))" | Add-Content $log
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  "$stamp  ERROR - no se encuentra node en el PATH" | Add-Content $log
  exit 1
}

Start-Process -FilePath $node `
  -ArgumentList '--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', 'server.js' `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $root 'server.out.log') `
  -RedirectStandardError  (Join-Path $root 'server.err.log')

Start-Sleep -Seconds 2
$now = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($now) {
  "$stamp  ARRANCADO (PID $($now[0].OwningProcess))" | Add-Content $log
  exit 0
} else {
  "$stamp  ERROR - no arranco; revisa server.err.log" | Add-Content $log
  exit 1
}
