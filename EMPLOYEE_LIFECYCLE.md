# Bajas, reingresos y eliminación recuperable

Gestión de Personal ofrece los filtros Vigentes, Dados de baja, Todos y Eliminados.
Cada fila tiene Más acciones: Historial laboral, Dar de baja, Reingreso,
Eliminar registro o Recuperar registro, según su estado y los permisos.

## Baja

`POST /api/employees/:id/termination`

```json
{"date":"2026-11-13","reason":"Renuncia voluntaria","notes":"Observaciones opcionales"}
```

Fecha efectiva = último día laboral, inclusive. Requiere fecha real no futura y
motivo; no puede ser anterior al inicio del período. Se conserva el expediente,
las checadas, las asignaciones y las incidencias. Se guarda el período terminado,
el usuario que registró la baja y la fecha de la operación. Las órdenes ADMS aún
pendientes se cancelan; las ya entregadas al reloj no pueden retirarse con esto.
La baja no elimina al usuario del dispositivo. El retiro físico del reloj es
una operación separada que no se ejecuta automáticamente en este flujo.

## Reingreso

`POST /api/employees/:id/rehire`

```json
{"date":"2026-11-13","notes":"Observaciones opcionales"}
```

Solo para personas dadas de baja. La fecha debe ser posterior a la última baja
y no futura. Crea otro período en la misma ficha y conserva los anteriores.
Actualiza la fecha de ingreso visible al inicio del período nuevo. No envía la
persona al reloj; revisar y asignar su horario antes de calcular asistencia.

`GET /api/employees/:id/employment-history` consulta los períodos registrados.
Datos laborales anteriores sin fecha de ingreso conocida se conservan con
inicio desconocido; no se inventa una fecha usando el alta técnica del registro.
Una vez que hay períodos, no se permiten cambios directos de sus fechas/estado
desde el endpoint genérico del expediente. Correcciones retroactivas de períodos
ya registrados requieren un flujo posterior; no se ofrece editar el historial.

## Eliminar y recuperar

`DELETE /api/employees/:id`, body `{"confirmation":"NUMERO_DEL_RELOJ"}`.

Exige escribir el número del reloj y confirmar en la pantalla. Se bloquea si hay
checadas (incluidas las sin vínculo que coincidan en dispositivo y número),
horarios, incidencias, comandos de dispositivo o períodos laborales. También se
bloquea si ya existe una baja registrada en el expediente.
Usa eliminación lógica (`deletedAt` y `deletedBy`): no borra físicamente la ficha.

`POST /api/employees/:id/restore` recupera el registro, conservando su identidad.
Recuperar no equivale a reingreso ni sincroniza con el dispositivo.
Los números de registros eliminados siguen reservados: recuperar el registro
existente antes de intentar crear otro con el mismo dispositivo y número.

## Permisos

- Bajas y reingresos: `employee.status` (ROOT, ADMIN, SUPERVISOR por defecto).
- Eliminar, listar eliminados y recuperar: `employee.delete` (ROOT, ADMIN).
- CONSULTA puede consultar el listado y el historial, sin ejecutar movimientos.

Filtro API: `GET /api/employees?laborStatus=ACTIVE|TERMINATED|ALL|DELETED`.
Sin parámetro se conserva la consulta ALL. ACTIVE incluye expedientes cuyo
estado todavía no se registró, para no ocultar empleados heredados.

## Sincronización y cálculo

La importación desde el reloj respeta fichas eliminadas y bajas laborales.
No restaura registros eliminados ni reactiva una baja porque el usuario siga
existiendo en el reloj. El envío directo, en lote y por ADMS se bloquea para bajas.

El cálculo individual y masivo evalúa solo los días dentro de períodos laborales.
Incluye personas dadas de baja cuando trabajaron en el período consultado,
aunque estén inactivas hoy. No genera faltas en el intervalo entre una baja y
un reingreso. Las fechas desconocidas de expedientes antiguos siguen siendo
desconocidas: su exactitud depende de completar los datos reales.

No sustituye el trabajo pendiente de versionado de horarios ni guarda cierres
inmutables de pre-nómina. El nombre del reloj y los datos personales conservan
su separación anterior. La API externa mantiene sus rutas originales de lectura.

## Instalación y verificación

El arranque ejecuta `ensureEmployeeLifecycleSchema`, que agrega las columnas
de eliminación lógica y crea `employment_periods` con un índice que impide dos
períodos abiertos para la misma persona. Las operaciones laborales se realizan
en transacciones con bloqueo de la fila del empleado.

Se comprobaron acciones, filtros, concurrencia, historial, recuperación y
protección de sincronización con fichas temporales en PostgreSQL real y HTTP.
Se retiraron las fichas de prueba sin modificar personas reales ni el reloj.
