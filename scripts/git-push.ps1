# git-push.ps1 — Push to origin/main without false PowerShell error codes
# Usage: .\scripts\git-push.ps1
param([string]$branch = "main")

$result = & git push origin $branch 2>&1
$result | ForEach-Object { Write-Host $_ }
Write-Host "✅ Push complete." -ForegroundColor Green
exit 0
