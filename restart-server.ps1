# Find and kill the process on port 5178
$conn = Get-NetTCPConnection -LocalPort 5178 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $procId = $conn.OwningProcess
    Write-Host "Killing process $procId on port 5178..."
    Stop-Process -Id $procId -Force
    Start-Sleep -Seconds 2
    Write-Host "Process killed."
} else {
    Write-Host "No process found on port 5178."
}

# Start the server in a new window
Write-Host "Starting Appraisal Agent server..."
Start-Process -FilePath "node" -ArgumentList "cacc-writer-server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Normal
Start-Sleep -Seconds 4

# Verify it's running
try {
    $health = Invoke-RestMethod -Uri "http://localhost:5178/api/health" -Method GET -TimeoutSec 10
    Write-Host "Server started successfully. Health: ok=$($health.ok)"
} catch {
    Write-Host "Server health check failed: $_"
}

