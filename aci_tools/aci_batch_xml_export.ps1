# aci_batch_xml_export.ps1
# Uses Windows UI Automation to drive ACI Report32.exe 
# and batch-export all .aci files to MISMO XML format

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$report32 = "C:\Program Files (x86)\ACI32\Applications\Report32.exe"
$aciDir = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Get list of .aci files
$aciFiles = Get-ChildItem $aciDir -Recurse -Filter "*.aci" | Select-Object -ExpandProperty FullName
Write-Host "Found $($aciFiles.Count) .aci files to export"

$exported = 0
$failed = 0

foreach ($aciFile in $aciFiles | Select-Object -First 5) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($aciFile)
    $outXml = Join-Path $outputDir "$baseName.xml"
    
    if (Test-Path $outXml) {
        Write-Host "Skip (exists): $baseName"
        $exported++
        continue
    }
    
    Write-Host "Processing: $baseName"
    
    try {
        # Launch Report32 with the .aci file
        $proc = Start-Process -FilePath $report32 -ArgumentList "`"$aciFile`"" -PassThru
        Start-Sleep -Seconds 3
        
        # Find the Report32 window
        $desktop = [System.Windows.Automation.AutomationElement]::RootElement
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
        
        $timeout = 10
        $window = $null
        while ($timeout -gt 0 -and $window -eq $null) {
            $window = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
            Start-Sleep -Milliseconds 500
            $timeout -= 0.5
        }
        
        if ($window) {
            Write-Host "  Window found: $($window.Current.Name)"
            # Try to use File > Export menu
            # For now just kill and try next approach
        }
        
        # Kill the process
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
        
    } catch {
        Write-Host "  Error: $($_.Exception.Message)"
        $failed++
    }
}

Write-Host "Done. Exported: $exported, Failed: $failed"
