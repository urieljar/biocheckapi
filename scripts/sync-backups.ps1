param(
  [string]$SourceDirectory = ".\backups",
  [Parameter(Mandatory = $true)][string]$DestinationDirectory
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($SourceDirectory)
$destination = [System.IO.Path]::GetFullPath($DestinationDirectory)
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "No existe la carpeta origen: $source"
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$files = Get-ChildItem -LiteralPath $source -File -Filter '*.dump'
if (-not $files) { throw "No hay archivos .dump en $source" }
foreach ($file in $files) {
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) -Force
  $hashFile = "$($file.FullName).sha256"
  if (Test-Path -LiteralPath $hashFile) {
    Copy-Item -LiteralPath $hashFile -Destination (Join-Path $destination (Split-Path $hashFile -Leaf)) -Force
  }
}
Write-Host "Copiados $($files.Count) respaldos a: $destination"
