# Reporte de Eventos

El menú Eventos conserva la ruta web `/asistencias`. No modifica checadas ni calcula faltas o retardos.

## API

Todos los endpoints requieren Bearer JWT y permiten los mismos roles autenticados que la consulta de asistencias.

- `GET /api/attendances/events`: reporte paginado.
- `GET /api/attendances/filters`: dispositivos, departamentos y cargos, incluidos inactivos para consultas anteriores.
- `GET /api/attendances/export.csv`: todos los resultados filtrados en CSV UTF-8, sin límite de la página visible.
- `GET /api/attendances`: conserva su contrato anterior.

Filtros compartidos entre listado y exportación: `from`, `to` (YYYY-MM-DD), `search` (nombre del reloj, nombre/apellido del perfil o número), `deviceUserId` (exacto), `employeeId`, `departmentId`, `positionId`, `deviceId`.
Paginación: `page` desde 1, `limit` 20 por defecto, máximo 100. La exportación ignora la página y tamaño después de validarlos.
Fechas inválidas o rango invertido devuelven 400. Las fechas se interpretan con límites UTC-07, igual que las consultas actuales del proyecto; salida en America/Mazatlan.

## Datos

Nombre: perfil laboral si existe, nombre del reloj como respaldo. Departamento/cargo: perfil actual, no una instantánea histórica del evento.
Se conservan checadas sin empleado o dispositivo vinculado. No se rellenan IP o nombres de reloj ficticios.
`eventType=UNCLASSIFIED` y `eventLabel=Sin clasificar`: no se dispone de un estado entrada/salida almacenado. No se deduce por orden de checadas.
No se cambia el modelo, la sincronización ni la base de datos para esta primera entrega.
El reporte no selecciona PIN ni datos personales adicionales del perfil.

## Exportación

CSV por lotes de 1000 filas, dentro de una transacción PostgreSQL de lectura REPEATABLE READ para mantener una instantánea durante la descarga.
Orden: fecha descendente y registro descendente. Incluye segundos, zona horaria, número, nombre, departamento, cargo, evento, dispositivo, IP y origen.
Las fórmulas peligrosas se neutralizan al exportar. Los datos originales no se alteran.
Los resultados pueden cambiar entre consultar y exportar si hubo importaciones o cambios de perfiles; cada exportación usa su propia instantánea.

## Verificación

`node --test test/event-report.test.js`: consultas, validación, roles, CSV con más de un lote y salida local con persistencia simulada.
Pendiente validar joins y exportación contra una base PostgreSQL de pruebas y revisar visualmente en navegador.
