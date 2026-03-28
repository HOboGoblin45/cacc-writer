# Kill any existing Chrome
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Find Chrome
$paths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
    Write-Host "ERROR: Chrome not found. Please install Chrome or update the path in this script."
    exit 1
}

Write-Host "Found Chrome at: $chrome"
Write-Host "Launching with remote debugging on port 9222..."

# Launch Chrome with debug port — each arg separate
Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\rq-session"
)

Start-Sleep -Seconds 4

# Verify port is active
try {
    $r = Invoke-WebRequest -Uri "http://localhost:9222/json/version" -TimeoutSec 5 -UseBasicParsing
    $info = $r.Content | ConvertFrom-Json
    Write-Host ""
    Write-Host "SUCCESS - Chrome debug port 9222 is active!"
    Write-Host "Browser: $($info.Browser)"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. In the Chrome window that opened, go to https://app.realquantum.com"
    Write-Host "  2. Log in and open your commercial appraisal"
    Write-Host "  3. Navigate to the first writing section"
    Write-Host "  4. Run: python real_quantum_agent/selector_discovery.py"
} catch {
    Write-Host ""
    Write-Host "WARNING: Port 9222 not responding yet. Chrome may still be starting."
    Write-Host "Wait 5 seconds and try: python real_quantum_agent/selector_discovery.py"
}
