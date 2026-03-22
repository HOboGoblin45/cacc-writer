# batch_convert.ps1
# Uses ACI's RapidToXmlString to batch-convert all 479 .aci files to MISMO XML

$controlsDir = "C:\Program Files (x86)\Common Files\ACI\Controls"
$aciDir = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Load assemblies
$needed = @("ACI.Framework.dll","ACI.Framework.FileSystem.dll","ACI.Framework.Tags.dll",
            "ACI.XmlMap.Translator.dll","ACI.MISMOTranslator.Components.Adaptors.dll","Interop40.RapidFileX.dll")
$subdirs = @($controlsDir) + (Get-ChildItem $controlsDir -Directory).FullName
foreach ($asm in $needed) {
    foreach ($dir in $subdirs) {
        $p = Join-Path $dir $asm
        if (Test-Path $p) { try { [System.Reflection.Assembly]::LoadFile($p) | Out-Null; break } catch {} }
    }
}

# Get all .aci files
$aciFiles = Get-ChildItem $aciDir -Recurse -Filter "*.aci" | Select-Object -ExpandProperty FullName
Write-Host "Found $($aciFiles.Count) .aci files"
Write-Host "Output dir: $outputDir"
Write-Host ""

$ok = 0; $fail = 0; $skip = 0

foreach ($aciFile in $aciFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($aciFile)
    $outXml = Join-Path $outputDir "$baseName.xml"
    
    if (Test-Path $outXml) {
        $skip++
        continue
    }
    
    try {
        $translator = New-Object ACI.MISMOTranslator.Components.Adaptors.AciMismoTranslatorNet
        $xmlStr = $translator.RapidToXmlString($aciFile)
        
        if ($xmlStr -and $xmlStr.Length -gt 100) {
            [System.IO.File]::WriteAllText($outXml, $xmlStr, [System.Text.Encoding]::UTF8)
            $ok++
            Write-Host "OK [$ok]: $baseName ($([Math]::Round($xmlStr.Length/1024))KB)"
        } else {
            $err = $translator.LastError
            Write-Host "EMPTY [$baseName]: $err"
            $fail++
        }
    } catch {
        Write-Host "ERROR [$baseName]: $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
        $fail++
    }
}

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Converted: $ok | Failed: $fail | Skipped: $skip"
Write-Host "Output: $outputDir"
