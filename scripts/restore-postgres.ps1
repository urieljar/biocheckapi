param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [switch]$ConfirmRestore,
  [switch]$SkipPreRestoreBackup
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) { throw 'Restaurar sobrescribe los datos actuales. Vuelve a ejecutar con -ConfirmRestore.' }
$resolved = [System.IO.Path]::GetFullPath($BackupFile)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "No existe el respaldo: $resolved" }
$container = (docker compose ps -q database).Trim()
if ([string]::IsNullOrWhiteSpace($container)) { throw 'No se encontró el contenedor database.' }
docker cp $resolved "${container}:/tmp/biotime-restore.dump" | Out-Null
docker compose exec -T database pg_restore --list /tmp/biotime-restore.dump | Out-Null
$catalogExit = $LASTEXITCODE
if ($catalogExit -ne 0) { throw 'El archivo no es un dump PostgreSQL válido o está dañado.' }
if (-not $SkipPreRestoreBackup) {
  $preDir = Join-Path (Split-Path -Parent $resolved) 'pre-restore'
  & (Join-Path $PSScriptRoot 'backup-postgres.ps1') -OutputDirectory $preDir -Verify
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el respaldo de seguridad previo a restaurar.' }
}
Write-Host 'Deteniendo la API para evitar escrituras durante la restauración...'
docker compose stop api
try {
  docker compose exec -T database sh -c 'pg_restore --clean --if-exists --no-owner --dbname="$POSTGRES_DB" /tmp/biotime-restore.dump'
  if ($LASTEXITCODE -ne 0) { throw "pg_restore terminó con código $LASTEXITCODE" }
} finally {
  docker compose exec -T database rm -f /tmp/biotime-restore.dump | Out-Null
  docker compose start api
}
Write-Host 'Restauración terminada. Verifica /api/health y los reportes antes de operar.'
