param(
  [Parameter(Mandatory = $true)][string]$BackupFile
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($BackupFile)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "No existe el respaldo: $resolved" }
$item = Get-Item -LiteralPath $resolved
if ($item.Length -lt 1024) { throw 'El respaldo es demasiado pequeño.' }
$hashFile = "$resolved.sha256"
if (Test-Path -LiteralPath $hashFile) {
  $expected = (Get-Content -LiteralPath $hashFile | Select-Object -First 1).Split(' ')[0]
  $actual = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
  if ($expected -ne $actual) { throw 'La suma SHA256 no coincide; el archivo puede estar dañado.' }
  Write-Host 'SHA256 correcto.'
}
$container = (docker compose ps -q database).Trim()
if ([string]::IsNullOrWhiteSpace($container)) { throw 'No se encontró el contenedor database.' }
docker cp $resolved "${container}:/tmp/biotime-verify.dump" | Out-Null
docker compose exec -T database pg_restore --list /tmp/biotime-verify.dump | Out-Null
$catalogExit = $LASTEXITCODE
docker compose exec -T database rm -f /tmp/biotime-verify.dump | Out-Null
if ($catalogExit -ne 0) { throw 'pg_restore no pudo leer el catálogo del dump.' }
Write-Host "Respaldo válido: $resolved"
