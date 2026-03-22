# batch_final.ps1 - MUST run in 32-bit PowerShell
# C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File batch_final.ps1

$mismoDir = "C:\Program Files (x86)\Common Files\ACI\Controls\ACI.MISMOTranslator"
$aciDir = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
$mapFile = "C:\Program Files (x86)\Common Files\ACI\ESERVICES\TRANSLATORS\ACI.XMLMap.MISMO.v2.6gse.xml"
$logFile = "$outputDir\conversion_log.txt"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Load assemblies
foreach ($dll in @("Interop.RapidFileX.dll","ACI.Framework.dll","ACI.Framework.FileSystem.dll","ACI.Framework.Tags.dll","ACI.XmlMap.Translator.dll","ACI.MISMOTranslator.Components.Adaptors.dll")) {
    $p = Join-Path $mismoDir $dll
    if (Test-Path $p) { try { [System.Reflection.Assembly]::LoadFrom($p) | Out-Null } catch {} }
}

$adaptor = New-Object ACI.MISMOTranslator.Components.Adaptors.XmlMapTranslatorAdaptor

$aciFiles = Get-ChildItem $aciDir -Recurse -Filter "*.aci" | Select-Object -ExpandProperty FullName
$total = $aciFiles.Count
Write-Host "=== ACI Batch XML Converter (32-bit) ==="
Write-Host "Files: $total | Output: $outputDir"
"Started $(Get-Date)" | Out-File $logFile

$ok = 0; $fail = 0; $skip = 0; $i = 0

foreach ($aciFile in $aciFiles) {
    $i++
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($aciFile)
    $outXml = Join-Path $outputDir "$baseName.xml"

    if (Test-Path $outXml) { $skip++; continue }

    try {
        $result = $adaptor.TranslateFile($aciFile, $mapFile)
        if ($adaptor.Xml -and $adaptor.Xml.Length -gt 500) {
            [System.IO.File]::WriteAllText($outXml, $adaptor.Xml, [System.Text.Encoding]::UTF8)
            $ok++
            $kb = [Math]::Round($adaptor.Xml.Length / 1024)
            Write-Host "[$i/$total] OK $baseName (${kb}KB)"
            "OK|$baseName|${kb}KB" | Add-Content $logFile
        } else {
            $err = $adaptor.LastError
            $short = if ($err.Length -gt 80) { $err.Substring(0,80) } else { $err }
            Write-Host "[$i/$total] FAIL $baseName - $short"
            "FAIL|$baseName|$short" | Add-Content $logFile
            $fail++
        }
    } catch {
        $msg = $_.Exception.Message
        $short = if ($msg.Length -gt 80) { $msg.Substring(0,80) } else { $msg }
        Write-Host "[$i/$total] ERR $baseName - $short"
        "ERR|$baseName|$short" | Add-Content $logFile
        $fail++
    }
}

$summary = "DONE: OK=$ok FAIL=$fail SKIP=$skip TOTAL=$total"
Write-Host ""
Write-Host "=== $summary ==="
$summary | Add-Content $logFile
