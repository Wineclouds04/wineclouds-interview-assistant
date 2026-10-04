$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$desktopDir = Join-Path $PSScriptRoot 'desktop'
$electronPath = Join-Path $desktopDir 'node_modules\electron\dist\electron.exe'
$frontendIndex = Join-Path $PSScriptRoot 'frontend\dist\index.html'
foreach ($requiredPath in @($pythonPath, $electronPath, $frontendIndex)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required launch file is missing: $requiredPath"
    }
}

$env:PATH = "$(Split-Path -Parent $pythonPath);$env:PATH"
$env:IA_PYTHON = $pythonPath
$env:PYTHONUTF8 = '1'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$logDir = Join-Path $PSScriptRoot 'log'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$desktopArgs = '"' + $desktopDir + '"'
Start-Process -FilePath $electronPath -ArgumentList $desktopArgs -WorkingDirectory $PSScriptRoot -WindowStyle Normal -RedirectStandardOutput (Join-Path $logDir 'desktop.log') -RedirectStandardError (Join-Path $logDir 'desktop-error.log')
