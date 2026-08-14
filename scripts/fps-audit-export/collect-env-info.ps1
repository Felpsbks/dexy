# Fase 7.6 -- coleta info de ambiente da Maquina B (Windows/CPU/GPU/driver).
# Roda sozinho, nao precisa de nada instalado alem do Windows/PowerShell.
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor
$gpu = Get-CimInstance Win32_VideoController

$report = @()
$report += "=== Windows ==="
$report += "$($os.Caption) - Build $($os.BuildNumber) - $($os.OSArchitecture)"
$report += ""
$report += "=== CPU ==="
$report += "$($cpu.Name)"
$report += ""
$report += "=== GPU(s) ==="
$gpu | ForEach-Object { $report += "$($_.Name) | Driver: $($_.DriverVersion) | Driver date: $($_.DriverDate)" }
$report += ""
$report += "=== Chrome instalado ==="
$chromePaths = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
$found = $false
foreach ($p in $chromePaths) {
  if (Test-Path $p) {
    $ver = (Get-Item $p).VersionInfo.ProductVersion
    $report += "$p -> versao $ver"
    $found = $true
  }
}
if (-not $found) { $report += "Chrome nao encontrado nos caminhos padrao -- informe manualmente (chrome://version)." }

$report | Out-File -FilePath "env-info-maquinaB.txt" -Encoding utf8
$report | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "Salvo em env-info-maquinaB.txt"
