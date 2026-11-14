# Piloto: integración del cálculo de asistencias

Proceso independiente de solo lectura. Reutiliza el cálculo de la pantalla de
Pre-Nómina; no inicia tareas del reloj ni ejecuta sync/migraciones. No cambia
la API interna ni la interfaz. Este piloto incluye catálogo mínimo de empleados
y cálculo; la exportación de reportes de checadas queda fuera de esta primera prueba.

## Demostración local con PostgreSQL real

Desde PowerShell, con PostgreSQL de Docker disponible en localhost:5433:

```powershell
Set-Location C:\opencode\biotimeuriel\backend
node src/scripts/demo-integration.js
```

Carga las credenciales de base de datos de `.env`, conecta a localhost:5433
(modificable con `DEMO_DB_PORT`) y escucha exclusivamente en 127.0.0.1:3001.
Selecciona ABRIL si está entre los primeros 100 empleados; de lo contrario usa
el primer empleado. Consulta del 1 al 29 de octubre de 2026. No crea datos.
Genera una clave aleatoria nueva en cada inicio, válida mientras vive ese proceso.
Detén el proceso anterior antes de volver a ejecutar el comando.

Archivos locales generados, ignorados por Git:

- `.local/integration-demo.postman_collection.json`: importa en Postman con Import > Files.
  Contiene URL, credencial y empleado ya configurados. Ejecuta las dos solicitudes.
- `.local/integration-demo.credentials.json`: URL y clave para un consumidor local.
- `.local/integration-demo.result.json`: evidencia de la consulta real y de los bloqueos.

La colección contiene una credencial: consérvala localmente. Al reiniciar la demo,
vuelve a importar la colección, ya que cambia la clave.

## Ejemplo desde otro sistema (PowerShell)

Mientras la demostración siga ejecutándose, abre otra terminal:

```powershell
Set-Location C:\opencode\biotimeuriel\backend
$integration = Get-Content .local/integration-demo.credentials.json -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($integration.apiKey)" }
$employees = Invoke-RestMethod -Uri "$($integration.baseUrl)/employees?limit=100" -Headers $headers
$employee = $employees.data | Where-Object name -Match 'ABRIL' | Select-Object -First 1
if (-not $employee) { $employee = $employees.data | Select-Object -First 1 }
$result = Invoke-RestMethod -Uri "$($integration.baseUrl)/attendance-calculations/employees/$($employee.id)?from=2026-10-01&to=2026-10-29" -Headers $headers
$result.data.summary
$result.data.days | Format-Table date, status, firstEntry, lastExit, workedMinutes
```

## Contrato v1

Todas las solicitudes requieren `Authorization: Bearer <clave>`.

- `GET /api/integrations/v1/employees?page=1&limit=20`: devuelve el catálogo con
  id UUID, employeeNumber, nombre y apellidos, departamento, puesto/cargo, área,
  estado laboral y contacto autorizado. Páginas de máximo 100 elementos.
- `GET /api/integrations/v1/employees/:employeeId`: expediente laboral y de contacto
  autorizado: nombres, número de empleado, departamento, puesto, área, tipo y estado
  laboral, fechas de ingreso/baja, motivo de baja, teléfonos, correo, ciudad,
  fecha de nacimiento y estado de sincronización del reloj.
  El UUID identifica al empleado; el número del reloj puede repetirse entre dispositivos.
- `GET /api/integrations/v1/attendance-calculations/employees/:employeeId?from=YYYY-MM-DD&to=YYYY-MM-DD`.
  También admite `?date=YYYY-MM-DD`. Rango inclusivo de 1 a 31 días, fechas reales.
  Devuelve employee, from, to, timeZone, summary y days.
- `GET /api/integrations/v1/attendance-events?sinceId=0&limit=50`: consulta las
  checadas nuevas desde el cursor indicado. Devuelve `cursor.sinceId` para que el
  consumidor lo guarde y lo envíe en la siguiente consulta. Admite `employeeNumber`.
  Es consulta incremental sobre las checadas ya sincronizadas en PostgreSQL.
- Cada día devuelve date, status, statuses, reason, firstEntry, lastExit, punches y workedMinutes.
  No expone el objeto de incidencia, sus notas, PIN, tarjeta ni configuración del dispositivo.
- El expediente tampoco expone PIN/contraseña del reloj, NSS, CURP/identificación,
  dirección, documentos ni fotografías.
- Conserva las reglas y los contadores del módulo actual: `present` cuenta el estado
  principal PRESENT; los días con LATE/EARLY_DEPARTURE/INCOMPLETE pueden tener checadas
  sin sumarse a present. Los contadores no son categorías mutuamente excluyentes.
  Es cálculo al momento, no un cierre definitivo ni un cálculo monetario de nómina.
- 400: parámetros inválidos; 401: credencial inválida; 404: empleado inexistente u
  operación no publicada; 429: más de 60 consultas autenticadas por minuto;
  500: error interno con mensaje genérico.
- Todos los endpoints externos son `GET`; no existen rutas para crear, editar, dar de
  baja, eliminar empleados, registrar checadas o modificar horarios.
- La respuesta de `attendance-events` contiene únicamente la checada, el empleado
  (nombre, nombre de pila y apellidos) y el dispositivo; no incluye clasificación
  de evento ni tipo de biometría.

## Arranque configurable después del piloto

`node src/integration/server.js` carga `.env` y exige `INTEGRATION_API_KEY_SHA256`
con el SHA-256 hexadecimal de una clave aleatoria. El servidor conserva el hash,
no necesita la clave original. Configura `INTEGRATION_PORT` (3001 por defecto),
`INTEGRATION_HOST` (127.0.0.1 por defecto) y las variables DB habituales según el
entorno. No es el comando de la demo: no sobrescribe DB_HOST ni DB_PORT.

Solo hay una credencial para este piloto; puede consultar todos los empleados.
Cambiar el hash y reiniciar revoca la credencial anterior. El límite de consultas
es global y en memoria por proceso. Registra método, ruta y estado sin credenciales.

La prueba es local. Para conectar un servicio externo se necesita configurar HTTPS
y un proxy que publique únicamente este proceso, manteniendo privados los puertos
de PostgreSQL, la API interna y ADMS. La clave se guarda en el backend consumidor.
Si se requieren varios consumidores o acceso por departamento/empleado, hay que
añadir credenciales y autorizaciones independientes antes de compartirla.
