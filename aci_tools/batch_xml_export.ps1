# batch_xml_export.ps1
# Uses ACI's own .NET assemblies to batch-export all .aci files to MISMO XML
# Run with: powershell -ExecutionPolicy Bypass -File batch_xml_export.ps1

$controlsDir = "C:\Program Files (x86)\Common Files\ACI\Controls"
$aciDir = "C:\Users\ccres\OneDrive\Desktop\CACC Appraisals"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host "=== ACI Batch XML Export ==="
Write-Host "Loading ACI assemblies..."

# Load the required .NET assemblies
$assemblies = @(
    "ACI.Framework.dll",
    "ACI.Framework.FileSystem.dll",
    "ACI.Framework.Tags.dll",
    "ACI.XmlMap.Translator.dll",
    "ACI.MISMOTranslator.dll",
    "ACI.MISMOTranslator.Components.Adaptors.dll",
    "Interop40.RapidFileX.dll"
)

# Find subdirs with assemblies (there are multiple versions)
$subdirs = Get-ChildItem $controlsDir -Directory | Select-Object -ExpandProperty FullName
$subdirs = @($controlsDir) + $subdirs

foreach ($asm in $assemblies) {
    $loaded = $false
    foreach ($dir in $subdirs) {
        $path = Join-Path $dir $asm
        if (Test-Path $path) {
            try {
                [System.Reflection.Assembly]::LoadFile($path) | Out-Null
                Write-Host "  Loaded: $asm"
                $loaded = $true
                break
            } catch {
                # Try next dir
            }
        }
    }
    if (-not $loaded) {
        Write-Host "  MISSING: $asm"
    }
}

# List loaded ACI types
$aciTypes = [System.AppDomain]::CurrentDomain.GetAssemblies() | 
    Where-Object { $_.FullName -match 'ACI|MISMO|RapidFile|Translator' } |
    ForEach-Object { $_.GetTypes() } | 
    Where-Object { $_.IsPublic -and -not $_.IsAbstract }

Write-Host ""
Write-Host "Available ACI types:"
$aciTypes | Select-Object FullName | Format-Table -AutoSize
