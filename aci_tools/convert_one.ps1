# convert_one.ps1 - Must run in 32-bit PowerShell!
param(
    [string]$AciFile = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\February\2026-02-24 - 49441 - 705 Cullom St Normal\49441.aci",
    [string]$OutFile = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports\test_49441.xml"
)

Write-Host "Is 32-bit: $([IntPtr]::Size -eq 4)"

$mismoDir = "C:\Program Files (x86)\Common Files\ACI\Controls\ACI.MISMOTranslator"
$ctrlDir = "C:\Program Files (x86)\Common Files\ACI\Controls"

$dlls = @(
    "$mismoDir\Interop.RapidFileX.dll",
    "$mismoDir\ACI.Framework.dll",
    "$mismoDir\ACI.Framework.FileSystem.dll",
    "$mismoDir\ACI.Framework.Tags.dll",
    "$mismoDir\ACI.XmlMap.Translator.dll",
    "$mismoDir\ACI.MISMOTranslator.Components.Adaptors.dll"
)

foreach ($dll in $dlls) {
    if (Test-Path $dll) {
        try { [System.Reflection.Assembly]::LoadFrom($dll) | Out-Null }
        catch { Write-Host "Failed: $(Split-Path $dll -Leaf)" }
    }
}

$mapFile = "C:\Program Files (x86)\Common Files\ACI\ESERVICES\TRANSLATORS\ACI.XMLMap.MISMO.v2.6gse.xml"

try {
    $adaptor = New-Object ACI.MISMOTranslator.Components.Adaptors.XmlMapTranslatorAdaptor
    $result = $adaptor.TranslateFile($AciFile, $mapFile)
    Write-Host "Result: $result | XML: $($adaptor.Xml.Length) chars"
    
    if ($adaptor.Xml.Length -gt 100) {
        [System.IO.File]::WriteAllText($OutFile, $adaptor.Xml)
        Write-Host "SUCCESS: Written to $OutFile"
        Write-Host "AddendumText: $($adaptor.AddendumText.Length) chars"
        if ($adaptor.AddendumText.Length -gt 0) {
            Write-Host $adaptor.AddendumText.Substring(0, [Math]::Min(500, $adaptor.AddendumText.Length))
        }
    } else {
        Write-Host "FAIL LastError: $($adaptor.LastError)"
    }
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
    Write-Host $_.Exception.StackTrace
}
