# Check Chrome processes
$procs = Get-Process chrome -ErrorAction SilentlyContinue
Write-Host "Chrome processes running: $($procs.Count)"

# Check if port 9222 is listening
$port = Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue
if ($port) {
    Write-Host "Port 9222 IS listening (PID $($port.OwningProcess))"
} else {
    Write-Host "Port 9222 is NOT listening"
}

# Kill all Chrome
Write-Host "Killing all Chrome processes..."
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Verify killed
$remaining = Get-Process chrome -ErrorAction SilentlyContinue
Write-Host "Chrome processes after kill: $($remaining.Count)"

# Launch Chrome with debug port using cmd.exe (most reliable on Windows)
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chromePath)) {
    Write-Host "ERROR: Chrome not found"
    exit 1
}

Write-Host "Launching Chrome from: $chromePath"
$args = "--remote-debugging-port=9222 --user-data-dir=C:\rq-session --no-first-run --no-default-browser-check"
Start-Process -FilePath $chromePath -ArgumentList $args
Write-Host "Chrome launched. Waiting 5 seconds..."
Start-Sleep -Seconds 5

# Check port again
$port2 = Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue
if ($port2) {
    Write-Host ""
    Write-Host "SUCCESS - Port 9222 is now active!"
    Write-Host "Now:"
    Write-Host "  1. Go to https://app.realquantum.com in the Chrome window"
    Write-Host "  2. Log in and open your commercial appraisal"
    Write-Host "  3. Run: python real_quantum_agent/selector_discovery.py"
} else {
    Write-Host ""
    Write-Host "Port 9222 still not active after launch."
    Write-Host "Try opening Chrome manually and navigating to: chrome://version"
    Write-Host "Check if 'Command Line' shows --remote-debugging-port=9222"
}
