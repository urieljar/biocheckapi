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

Para generar una credencial nueva de lectura:

```powershell
node src/scripts/generate-integration-read-key.js
```

Agrega el hash mostrado como `INTEGRATION_API_KEY_SHA256` en `.env`, reinicia
el servicio `integration` y usa el `apiKey` de
`.local/integration-read.credentials.json` en Postman.

## Contrato v2 de escritura

La v2 está separada de la v1 y permite administrar empleados desde un sistema
consumidor. Usa una credencial distinta: configura
`INTEGRATION_WRITE_API_KEY_SHA256` en el servidor y genera la pareja con:

```powershell
node src/scripts/generate-integration-write-key.js
```

La clave queda en `.local/integration-write.credentials.json`; el hash va en
`.env`. Todas las mutaciones requieren `Authorization: Bearer <clave>` y
quedan registradas en la auditoría con estado anterior y nuevo.

```http
GET  /api/integrations/v2/departments
GET  /api/integrations/v2/positions
GET  /api/integrations/v2/areas
POST /api/integrations/v2/departments
PATCH /api/integrations/v2/departments/:id
DELETE /api/integrations/v2/departments/:id
POST /api/integrations/v2/positions
PATCH /api/integrations/v2/positions/:id
DELETE /api/integrations/v2/positions/:id
POST /api/integrations/v2/areas
PATCH /api/integrations/v2/areas/:id
DELETE /api/integrations/v2/areas/:id
POST /api/integrations/v2/employees
PATCH /api/integrations/v2/employees/:employeeId
POST /api/integrations/v2/employees/:employeeId/terminate
POST /api/integrations/v2/employees/:employeeId/reactivate
```

Los tres endpoints de catálogo devuelven únicamente elementos activos con
`id`, `code`, `name` y `parentId`. Úsalos para obtener los identificadores o
confirmar los nombres antes de enviar un empleado.

Para crear un catálogo envía `code`, `name` y opcionalmente `parentId`.
`PATCH` modifica esos campos o `active`. `DELETE` no borra físicamente: marca
el catálogo como inactivo para conservar historiales.

Alta mínima:

```json
{
  "deviceUserId": "108070050",
  "name": "NOMBRE COMPLETO",
  "firstName": "NOMBRE",
  "lastName": "APELLIDOS",
  "employeeNumber": "108070050",
  "department": "Operación",
  "cargo": "Anfitrión",
  "area": "Discovery",
  "hireDate": "2026-11-16",
  "employmentType": "Planta"
}
```

Actualización: envía solo los campos que deben cambiar. La baja requiere
`date` y `reason`; la reactivación requiere una fecha posterior a la última
baja.

`department`, `cargo`/`position` y `area` aceptan UUID, código o nombre exacto
de un catálogo activo. También puedes enviar directamente `departmentId`,
`positionId` y `areaId`.

La v2 no elimina físicamente empleados ni registra checadas manuales. Las
altas y cambios quedan `PENDING` para que el proceso normal los sincronice al
reloj; la API externa no se conecta directamente al dispositivo.

## Horarios en v2

```http
GET    /api/integrations/v2/schedules
GET    /api/integrations/v2/schedules/:id
POST   /api/integrations/v2/schedules
PATCH  /api/integrations/v2/schedules/:id
DELETE /api/integrations/v2/schedules/:id
POST   /api/integrations/v2/schedules/:scheduleId/assign
GET    /api/integrations/v2/employees/:employeeId/schedules
GET    /api/integrations/v2/employees/:employeeId/sync-status
```

Para crear o actualizar un horario envía `name`, `type`, `toleranceMinutes` y
los siete elementos de `days` (`dayOfWeek` del 0 al 6). Para asignarlo envía
`employeeIds` y `validFrom` con formato `YYYY-MM-DD`. Un empleado dado de baja
no puede recibir horarios; `DELETE` desactiva el horario y no lo borra si tiene
asignaciones activas.

`sync-status` es de solo lectura y usa el token de lectura. Devuelve `PENDING`,
`SYNCED` o `ERROR`, junto con `syncedAt`, el último error y el reloj asociado.
`SYNCED` significa que el usuario fue reconciliado por la sincronización; no es
una confirmación de que una huella o rostro concreto haya sido aceptado.

## Cálculo de asistencia completo en v1

La integración v1 es de solo lectura y usa el mismo motor de cálculo que el
frontend. Ahora expone el detalle completo para un empleado, toda la empresa o
un departamento:

```http
GET /api/integrations/v1/attendance-calculations/employees/:employeeId?from=2026-11-01&to=2026-11-17
GET /api/integrations/v1/attendance-calculations/company?from=2026-11-01&to=2026-11-17
GET /api/integrations/v1/attendance-calculations/departments/:departmentId?from=2026-11-01&to=2026-11-17
```

Cada día incluye `rule` (horario aplicado), `exception` (permiso, vacaciones,
incapacidad u otra incidencia), `punchDetails` (id, hora, fecha original y
origen), `punches`, estado, motivo y minutos trabajados. Los resultados masivos
incluyen el resumen de cada empleado y el resumen global. El rango está limitado
a 31 días por consulta.

## Contrato v3: Puente Directo de Reloj (Clock Gateway)

La integración v3 permite a sistemas externos (ERP, control de acceso, nóminas externas)
interactuar **directamente con los relojes biométricos ZKTeco** sin crear empleados,
perfiles ni alterar la base de datos de personal de BioCheck (`storedInBioCheckEmployees: false`).

### Credencial de Acceso v3

Se configura en `.env` mediante `INTEGRATION_V3_API_KEY_SHA256` (hash SHA-256).
Para generar una clave nueva:

```powershell
node src/scripts/generate-integration-v3-key.js
```

La clave privada se guarda en `.local/integration-v3.credentials.json`.
Todas las solicitudes requieren el encabezado:

```http
Authorization: Bearer <API_KEY_V3>
```

### Endpoints de Relojes y Estado

```http
GET  /api/integrations/v3/devices
GET  /api/integrations/v3/devices/:deviceId/status
POST /api/integrations/v3/devices/:deviceId/test-connection
```

- `GET /devices`: Lista los relojes activos registrados con su `deviceId` (UUID), IP, puerto y estado ADMS.
- `GET /devices/:deviceId/status`: Consulta el estado de conectividad TCP y ADMS del reloj.
- `POST /devices/:deviceId/test-connection`: Ejecuta un ping/handshake TCP directo con el dispositivo.

### Endpoints de Usuarios en el Reloj (Clock Users)

```http
GET    /api/integrations/v3/devices/:deviceId/clock-users
GET    /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
POST   /api/integrations/v3/devices/:deviceId/clock-users
PATCH  /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
DELETE /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
POST   /api/integrations/v3/devices/:deviceId/clock-users/verify
GET    /api/integrations/v3/device-operations/:operationId
```

#### 1. Crear usuario en el reloj (`POST /clock-users`)

Cuerpo de la petición:
```json
{
  "deviceUserId": "108070050",
  "deviceUid": 60,
  "name": "JUAN PEREZ",
  "deviceRole": 0,
  "devicePin": "1234",
  "cardNumber": "987654321"
}
```

- `deviceUserId`: Identificador del usuario (string, máximo 50 caracteres).
- `deviceUid`: ID numérico interno en el reloj (entero entre 1 y 65535, único en el reloj).
- `name`: Nombre que se mostrará en la pantalla del reloj (máximo 160 caracteres).
- `deviceRole`: Rol en el reloj (`0`: Empleado, `2`: Registrar, `8`: Personalizado, `14`: Super Admin).
- `devicePin`: PIN numérico opcional (máximo 20 dígitos) o `null`.
- `cardNumber`: Número de tarjeta RFID/proximidad opcional o `null`.

**Comportamiento de transporte:**
- Si `deviceUserId.length <= 8`: Se escribe por **TCP directo** y se verifica inmediatamente en el hardware (HTTP 201 `status: VERIFIED`).
- Si `deviceUserId.length > 8`: Se encola automáticamente por **ADMS** (HTTP 202 `transport: ADMS`, devolviendo `operationId` para seguimiento).

#### 2. Actualizar usuario en el reloj (`PATCH /clock-users/:deviceUserId`)

Modifica los campos `name`, `deviceRole`, `devicePin` o `cardNumber`. Los campos `deviceUserId` y `deviceUid` son inmutables.

#### 3. Retirar usuario del reloj (`DELETE /clock-users/:deviceUserId`)

Elimina al usuario y sus biométricos (huellas y rostros) del hardware.
Requiere confirmación en el cuerpo:
```json
{
  "confirmationDeviceUserId": "108070050"
}
```

#### 4. Verificar presencia en el reloj (`POST /clock-users/verify`)

Valida si un usuario existe (`EXISTS`) o está ausente (`ABSENT`) físicamente en el dispositivo:
```json
{
  "deviceUserId": "108070050",
  "expected": "EXISTS"
}
```

#### 5. Consultar operación ADMS (`GET /device-operations/:operationId`)

Permite al sistema externo monitorear si una operación encolada fue recibida y confirmada por el reloj (`PENDING`, `SUCCESS`, `ERROR`).
