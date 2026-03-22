# batch_convert_v3.ps1
# Uses ACI's XmlMapTranslatorAdaptor with proper XML map files to batch-convert .aci -> XML

$controlsDir = "C:\Program Files (x86)\Common Files\ACI\Controls"
$transDir = "C:\Program Files (x86)\Common Files\ACI\ESERVICES\TRANSLATORS"
$aciDir = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Load assemblies - use the MISMOTranslator subdirectory version which has the right deps
$mismoDir = Join-Path $controlsDir "ACI.MISMOTranslator"
$needed = @(
    @{File="ACI.Framework.dll"; Dirs=@($controlsDir, $mismoDir)},
    @{File="ACI.Framework.FileSystem.dll"; Dirs=@($controlsDir, $mismoDir)},
    @{File="ACI.Framework.Tags.dll"; Dirs=@($controlsDir, $mismoDir)},
    @{File="ACI.XmlMap.Translator.dll"; Dirs=@($mismoDir, $controlsDir)},
    @{File="ACI.MISMOTranslator.Components.Adaptors.dll"; Dirs=@($controlsDir, $mismoDir)},
    @{File="Interop40.RapidFileX.dll"; Dirs=@($controlsDir, $mismoDir)},
    @{File="rapidfilex.dll"; Dirs=@($controlsDir)}
)

foreach ($asm in $needed) {
    $loaded = $false
    foreach ($dir in $asm.Dirs) {
        $p = Join-Path $dir $asm.File
        if (Test-Path $p) { 
            try { [System.Reflection.Assembly]::LoadFile($p) | Out-Null; $loaded = $true; break } catch { }
        }
    }
    if (-not $loaded) { Write-Host "WARN: Could not load $($asm.File)" }
}

# Map file to use - v2.6GSE is the newest format (matches Charles's recent XML exports)
$mapFile = Join-Path $transDir "ACI.XMLMap.MISMO.v2.6gse.xml"
if (-not (Test-Path $mapFile)) {
    $mapFile = Join-Path $transDir "ACI.XMLMap.MISMO.v2.6.xml"
}
Write-Host "Using map: $mapFile"

$aciFiles = Get-ChildItem $aciDir -Recurse -Filter "*.aci" | Select-Object -ExpandProperty FullName
Write-Host "Found $($aciFiles.Count) .aci files"

$ok = 0; $fail = 0; $skip = 0

foreach ($aciFile in $aciFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($aciFile)
    $outXml = Join-Path $outputDir "$baseName.xml"
    
    if (Test-Path $outXml) { $skip++; continue }
    
    try {
        # Method 1: XmlMapTranslatorAdaptor.TranslateFile
        $adaptor = New-Object ACI.MISMOTranslator.Components.Adaptors.XmlMapTranslatorAdaptor
        $result = $adaptor.TranslateFile($aciFile, $mapFile, $outXml)
        
        if ((Test-Path $outXml) -and (Get-Item $outXml).Length -gt 500) {
            $size = [Math]::Round((Get-Item $outXml).Length / 1024)
            $ok++
            Write-Host "OK [$ok] $baseName (${size}KB)"
        } else {
            # Method 2: Try AciMismoTranslatorNet with XML map
            $translator = New-Object ACI.MISMOTranslator.Components.Adaptors.AciMismoTranslatorNet
            $xmlOut = ""
            $res = $translator.RapidToXmlString($aciFile, $mapFile, [ref]$xmlOut)
            
            if ($xmlOut -and $xmlOut.Length -gt 500) {
                [System.IO.File]::WriteAllText($outXml, $xmlOut, [System.Text.Encoding]::UTF8)
                $ok++
                Write-Host "OK2 [$ok] $baseName ($([Math]::Round($xmlOut.Length/1024))KB)"
            } else {
                $err = $translator.LastError
                Write-Host "FAIL [$baseName] res=$res err=$($err.Substring(0, [Math]::Min(80,$err.Length)))"
                $fail++
            }
        }
    } catch {
        $msg = $_.Exception.Message
        if ($msg.Length -gt 100) { $msg = $msg.Substring(0,100) }
        Write-Host "ERR [$baseName] $msg"
        $fail++
    }
}

Write-Host ""
Write-Host "=== DONE === OK:$ok FAIL:$fail SKIP:$skip"
