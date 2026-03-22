# run_export.ps1 - Use ACI's own .NET translator to batch export .aci -> XML

$controlsDir = "C:\Program Files (x86)\Common Files\ACI\Controls"
$outputDir = "C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\xml_exports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Load assemblies
$needed = @("ACI.Framework.dll","ACI.Framework.FileSystem.dll","ACI.Framework.Tags.dll",
            "ACI.XmlMap.Translator.dll","ACI.MISMOTranslator.Components.Adaptors.dll","Interop40.RapidFileX.dll")

$subdirs = @($controlsDir) + (Get-ChildItem $controlsDir -Directory).FullName
foreach ($asm in $needed) {
    foreach ($dir in $subdirs) {
        $p = Join-Path $dir $asm
        if (Test-Path $p) { 
            try { [System.Reflection.Assembly]::LoadFile($p) | Out-Null; break } catch {}
        }
    }
}

Write-Host "Assemblies loaded. Testing AciMismoTranslatorNet..."

try {
    $adaptor = New-Object ACI.MISMOTranslator.Components.Adaptors.AciMismoTranslatorNet
    Write-Host "AciMismoTranslatorNet: OK"
    Write-Host "Methods: $($adaptor.GetType().GetMethods() | ForEach-Object { $_.Name } | Sort-Object -Unique | Out-String)"
} catch {
    Write-Host "AciMismoTranslatorNet error: $_"
}

try {
    $adaptor2 = New-Object ACI.MISMOTranslator.Components.Adaptors.XmlMapTranslatorAdaptor
    Write-Host "XmlMapTranslatorAdaptor: OK"
    $methods = $adaptor2.GetType().GetMethods() | ForEach-Object { $_.Name } | Sort-Object -Unique
    Write-Host "Methods: $($methods -join ', ')"
} catch {
    Write-Host "XmlMapTranslatorAdaptor error: $_"
}

try {
    $adaptor3 = New-Object ACI.MISMOTranslator.Components.Adaptors.XmlMapTranslatorAdaptor2
    Write-Host "XmlMapTranslatorAdaptor2: OK"
    $methods = $adaptor3.GetType().GetMethods() | ForEach-Object { $_.Name } | Sort-Object -Unique
    Write-Host "Methods: $($methods -join ', ')"
} catch {
    Write-Host "XmlMapTranslatorAdaptor2 error: $_"
}

# Try XmlMap Translator directly
try {
    $trans = [ACI.XmlMap.Translator]
    Write-Host "Translator type: $trans"
    $staticMethods = $trans.GetMethods([System.Reflection.BindingFlags]::Static -bor [System.Reflection.BindingFlags]::Public)
    Write-Host "Static methods: $($staticMethods | ForEach-Object { $_.Name } | Out-String)"
} catch {
    Write-Host "Translator static error: $_"
}
