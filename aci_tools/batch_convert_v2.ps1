# batch_convert_v2.ps1
# Uses ACI's RapidToXmlString(rapidFilename, translatorFilename, [ref]xmlOut)

$controlsDir = "C:\Program Files (x86)\Common Files\ACI\Controls"
$xmlMapsDir = "C:\Program Files (x86)\ACI32\XML Maps"
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

# Map form type -> translator .ali file
$translatorMap = @{
    "1004_05UAD"  = "1004_05UAD.ali"
    "1004_05"     = "1004_05.ali"
    "1004_20UAD"  = "1004_20UAD.ali"
    "1004_20HUAD" = "1004_20HUAD.ali"
    "1025_05"     = "1025_05.ali"
    "1004C_05"    = "1004C_05.ali"
    "1073_05AUAD" = "1073_05AUAD.ali"
    "1075_05AUAD" = "1075_05AUAD.ali"
    "2055_05UAD"  = "2055_05UAD.ali"
    "MHAR"        = "MHAR.ali"
    "1004"        = "1004.ali"
    "1025"        = "MULTI(1025).ali"
}

# Helper: detect form type from ACI binary by reading field names
function Get-FormType($aciPath) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($aciPath)
        $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
        
        # Look for form type markers in the file
        foreach ($ftype in @("1004_05UAD","1004_20UAD","1004_20HUAD","1025_05","1073_05AUAD","1075_05AUAD","2055_05UAD","MHAR","1004C_05","1004_05")) {
            if ($ascii.Contains($ftype)) { return $ftype }
        }
        # Default to most common
        return "1004_05UAD"
    } catch { return "1004_05UAD" }
}

$aciFiles = Get-ChildItem $aciDir -Recurse -Filter "*.aci" | Select-Object -ExpandProperty FullName
Write-Host "Found $($aciFiles.Count) .aci files to convert"

$ok = 0; $fail = 0; $skip = 0
$translator = New-Object ACI.MISMOTranslator.Components.Adaptors.AciMismoTranslatorNet

foreach ($aciFile in $aciFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($aciFile)
    $outXml = Join-Path $outputDir "$baseName.xml"
    
    if (Test-Path $outXml) { $skip++; continue }
    
    try {
        # Detect form type
        $formType = Get-FormType $aciFile
        $aliFile = $translatorMap[$formType]
        if (-not $aliFile) { $aliFile = "1004_05UAD.ali" }
        
        $translatorPath = Join-Path $xmlMapsDir $aliFile
        if (-not (Test-Path $translatorPath)) {
            Write-Host "MISS [$baseName]: translator $aliFile not found"
            $fail++
            continue
        }
        
        # Call RapidToXmlString
        $xmlOut = ""
        $result = $translator.RapidToXmlString($aciFile, $translatorPath, [ref]$xmlOut)
        
        if ($xmlOut -and $xmlOut.Length -gt 500) {
            [System.IO.File]::WriteAllText($outXml, $xmlOut, [System.Text.Encoding]::UTF8)
            $ok++
            Write-Host "OK [$ok] $formType $baseName ($([Math]::Round($xmlOut.Length/1024))KB)"
        } else {
            $lastErr = $translator.LastError
            Write-Host "EMPTY [$baseName] form=$formType result=$result err=$lastErr"
            $fail++
        }
    } catch {
        $msg = $_.Exception.Message
        if ($msg.Length -gt 100) { $msg = $msg.Substring(0,100) }
        Write-Host "ERR [$baseName]: $msg"
        $fail++
    }
}

Write-Host ""
Write-Host "=== COMPLETE ==="
Write-Host "Converted: $ok | Failed: $fail | Skipped: $skip"
