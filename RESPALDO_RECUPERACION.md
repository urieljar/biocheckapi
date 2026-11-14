# Respaldo y recuperación

## Qué se respalda

PostgreSQL contiene empleados, checadas, horarios, incidencias, reportes,
auditoría y configuraciones. El respaldo usa el formato comprimido de
PostgreSQL (`.dump`). Las fotografías y documentos que se agreguen después
deben copiarse por separado.

## Respaldo automático

`docker compose up -d` levanta `database-backup`. El servicio espera a que la
base esté saludable y crea un respaldo cada 24 horas:

- `daily`: últimos 14 días.
- `weekly`: copias semanales durante 90 días.
- `monthly`: una copia el día 1 de cada mes durante 365 días.
- `backup.log`: resultado `OK` o `ERROR` de cada intento.

Comprobar el servicio y los archivos:

```powershell
docker compose ps database-backup
docker compose exec database-backup sh -c 'find /backups -maxdepth 2 -type f -print'
docker compose exec database-backup tail -n 20 /backups/backup.log
```

Estos respaldos están en el mismo equipo. Para protegerse contra una falla del
disco, copia los respaldos a otro disco, NAS o nube. Por ejemplo, si tienes una
carpeta sincronizada por OneDrive:

```powershell
.\scripts\backup-postgres.ps1 -OutputDirectory "$env:USERPROFILE\OneDrive\Respaldos\BioTime" -Verify
```

También puedes copiar una carpeta local ya creada:

```powershell
.\scripts\sync-backups.ps1 -SourceDirectory .\backups -DestinationDirectory D:\Respaldos\BioTime
```

## Respaldo manual y verificación

Desde `C:\opencode\biotimeuriel\backend`:

```powershell
.\scripts\backup-postgres.ps1 -Verify
```

Se genera el `.dump` y su archivo `.sha256`. La opción `-Verify` comprueba que
PostgreSQL pueda leer el catálogo del respaldo.

Para validar después una copia:

```powershell
.\scripts\verify-backups.ps1 -BackupFile .\backups\biotime-20261113-230000.dump
```

## Restauración segura

La restauración sobrescribe los datos actuales. El script valida el archivo y,
salvo que se indique lo contrario, crea primero un respaldo de seguridad en
`backups\pre-restore`.

```powershell
.\scripts\restore-postgres.ps1 `
  -BackupFile .\backups\biotime-20261113-230000.dump `
  -ConfirmRestore
```

El proceso detiene la API, restaura, vuelve a iniciar la API y usa el nombre de
la base configurado dentro del contenedor; no depende de una variable vacía de
PowerShell.

Después verifica:

```powershell
Invoke-WebRequest http://localhost:3000/api/health
docker compose ps
```

Luego revisa manualmente empleados, checadas, horarios y un reporte de
asistencia. No uses `-SkipPreRestoreBackup` salvo que ya hayas creado otro
respaldo actual.

## Procedimiento recomendado

1. Revisa diariamente que `database-backup` esté `Up`.
2. Revisa `backup.log` y que exista un archivo reciente.
3. Copia los respaldos fuera del equipo.
4. Haz una restauración de prueba al menos una vez al mes.
5. Conserva los respaldos mensuales durante un año.
