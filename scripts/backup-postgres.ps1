param(
  [string]$OutputDirectory = ".\backups",
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolved | Out-Null
$file = Join-Path $resolved ("biotime-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw "No se encontró .env: $envPath" }
$config = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ConvertFrom-StringData
$dbUser = [string]$config.DB_USER
$dbName = [string]$config.DB_NAME
if ([string]::IsNullOrWhiteSpace($dbUser) -or [string]::IsNullOrWhiteSpace($dbName)) { throw 'DB_USER y DB_NAME son obligatorios en .env.' }
$escapedFile = $file.Replace('"', '""')
$command = "docker compose exec -T database pg_dump --format=custom -U $dbUser -d $dbName > `"$escapedFile`""
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $file) -or ((Get-Item -LiteralPath $file).Length -lt 1024)) {
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  throw 'pg_dump no produjo un respaldo válido.'
}
$hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
"$hash  $([System.IO.Path]::GetFileName($file))" | Set-Content -LiteralPath "$file.sha256" -Encoding ascii
if ($Verify) {
  $container = (docker compose ps -q database).Trim()
  if ([string]::IsNullOrWhiteSpace($container)) { throw 'No se encontró el contenedor database.' }
  docker cp $file "${container}:/tmp/biotime-backup-check.dump" | Out-Null
  docker compose exec -T database pg_restore --list /tmp/biotime-backup-check.dump | Out-Null
  $verifyExit = $LASTEXITCODE
  docker compose exec -T database rm -f /tmp/biotime-backup-check.dump | Out-Null
  if ($verifyExit -ne 0) { throw 'El respaldo se creó, pero pg_restore no pudo leerlo.' }
}
Write-Host "Respaldo creado: $file"
Write-Host "SHA256: $hash"
