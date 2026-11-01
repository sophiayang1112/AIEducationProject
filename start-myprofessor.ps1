param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = Join-Path $env:LOCALAPPDATA 'MyProfessor'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
function Open-LearningPage([string]$url) {
    if ($NoBrowser) { Write-Output $url } else { Start-Process $url }
}
try {
foreach ($port in 8765..8785) {
    $url = "http://127.0.0.1:$port"
    try {
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
        if ($health.app -eq 'myprofessor-learning') { Open-LearningPage $url; return }
    } catch {}
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start(); $listener.Stop() } catch { continue }
    $pythonPath = $null
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $candidates = @((Join-Path $appRoot '.venv\Scripts\python.exe'), $pythonCommand.Source)
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate) -and $candidate -notlike '*WindowsApps*') {
            & $candidate -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>$null
            if ($LASTEXITCODE -eq 0) { $pythonPath = $candidate; break }
        }
    }
    if (-not $pythonPath) { throw 'Python 3.10 or newer was not found. Please restore the Python installation.' }
    Start-Process -FilePath $pythonPath -ArgumentList @('"' + (Join-Path $appRoot 'learning-server.py') + '"', '--port', $port) -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataRoot 'server.log') -RedirectStandardError (Join-Path $dataRoot 'server-error.log')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2; if ($health.app -eq 'myprofessor-learning' -and $health.token) { Open-LearningPage $url; return } } catch {}
    }
    throw 'Learning server did not start. Check the server-error.log file in LocalAppData\MyProfessor.'
}
throw 'No available port between 8765 and 8785.'
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Learning Park - Startup Error', 'OK', 'Error') | Out-Null
    exit 1
}
