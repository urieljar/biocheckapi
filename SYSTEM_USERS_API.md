# Usuarios del sistema

Estas cuentas acceden al panel web. Son independientes de los empleados y de los roles del reloj.
Los cuatro roles y la matriz completa están en [ROLES.md](ROLES.md).

Todas las rutas siguientes, salvo login, requieren `Authorization: Bearer <token>`.
`/api/users` está disponible para `ROOT` y `ADMIN`; un `ADMIN` solo opera cuentas
`SUPERVISOR` y `CONSULTA`. Los cuatro roles pueden consultar su cuenta, editar su propio
nombre y correo, y cambiar su propia contraseña. El rol se consulta en la base en cada petición.

| Método | Ruta | Cuerpo / consulta |
| --- | --- | --- |
| POST | `/api/auth/login` | `{ "email": "admin@example.com", "password": "..." }` |
| GET | `/api/auth/me` | Sin cuerpo |
| PATCH | `/api/auth/me` | Uno o ambos de `{ "name": "Operador", "email": "operador@example.com" }` |
| PATCH | `/api/auth/password` | `{ "currentPassword": "...", "newPassword": "..." }` |
| POST | `/api/users` | `{ "name": "Supervisor", "email": "supervisor@example.com", "password": "UnaClave12345", "role": "SUPERVISOR" }` |
| GET | `/api/users` | `?page=1&limit=20&search=supervisor&role=SUPERVISOR&active=true` |
| GET | `/api/users/:id` | Sin cuerpo |
| PATCH | `/api/users/:id` | Uno o más de `name`, `email`, `role` |
| PATCH | `/api/users/:id/status` | `{ "active": false }` o `{ "active": true }` |
| PATCH | `/api/users/:id/password` | `{ "password": "OtraClave12345" }` |

## Permisos por módulo

Los cuatro roles pueden consultar (`GET`) todos los módulos. La diferencia está en la
escritura y en las operaciones sobre el reloj:

| Módulo | ROOT | ADMIN | SUPERVISOR | CONSULTA |
| --- | :--: | :--: | :--: | :--: |
| Empleados: alta, edición y perfil | Sí | Sí | Sí | No |
| Activar o desactivar un empleado | Sí | Sí | Sí | No |
| Descargar checadas del reloj | Sí | Sí | Sí | No |
| Importar usuarios del reloj (`/api/devices/sync-users`) | Sí | Sí | No | No |
| Horarios y asignaciones de horario | Sí | Sí | Sí | No |
| Catálogos: departamentos, áreas, puestos | Sí | Sí | Sí | No |
| Incidencias y festivos | Sí | Sí | Sí | No |
| Cuentas `SUPERVISOR` y `CONSULTA` | Sí | Sí | No | No |
| Cuentas `ADMIN` y `ROOT` | Sí | No | No | No |
| Cuenta propia (`/api/auth/me`, `/api/auth/password`) | Sí | Sí | Sí | Sí |

Las rutas sin capacidad responden `403`:
`{ "ok": false, "message": "No tienes permisos para esta operación" }`.
En el panel, esas pantallas no aparecen en el menú y `RequireCapability` redirige a `/`
si se escribe la URL directamente. Un `ADMIN` ve la fila de un `ADMIN` con la etiqueta
"Solo ROOT" en lugar de los botones de gestión, y la cuenta `ROOT` no le aparece.

## Reglas

- Roles admitidos: `ROOT`, `ADMIN`, `SUPERVISOR` y `CONSULTA`; crear sin rol asigna
  `CONSULTA`. La cuenta nueva está activa.
- `PATCH /api/auth/me` solo acepta `name` y `email`; `role`, `active` y `passwordHash`
  se rechazan con `400`, de modo que ninguna cuenta puede elevar sus privilegios
  ni editar su estado. `PATCH /api/auth/password` exige `currentPassword`.
- Contraseñas: al menos 10 caracteres y máximo 72 bytes UTF-8 por el límite de bcrypt.
- Los correos se normalizan a minúsculas y deben ser únicos.
- `id` es el UUID de la cuenta, independiente del identificador del empleado.
- Se rechazan campos adicionales; no se acepta `passwordHash` del cliente.
- Ninguna respuesta de estas rutas incluye el hash de contraseña.
- No hay eliminación física: se utiliza desactivación.
- No se puede desactivar ni quitar el rol al último `ROOT` activo. Los cambios
  administrativos se serializan mediante un bloqueo transaccional de PostgreSQL.
- Desactivar una cuenta bloquea sus tokens en la siguiente petición. Cambiar contraseña
  no revoca los JWT ya emitidos; expiran según `JWT_EXPIRES_IN` (8 horas por defecto).
  Reactivar la cuenta permite volver a usar un token que aún no haya expirado.
- El primer propietario se crea con `npm run create-admin`, configurando
  `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y las variables de conexión en el entorno.
  No existe registro público de cuentas.
- Las cuentas antiguas con rol `USER` se crean y se evalúan como `SUPERVISOR`.
  `npm run migrate-roles` normaliza la columna; ver [ROLES.md](ROLES.md).
- No se necesitan columnas nuevas: `role` sigue siendo `VARCHAR` con validación en el modelo.

## Respuestas

Éxito: `{ "ok": true, "data": { ... } }`. Crear devuelve `201`; las demás operaciones, `200`.
Cambiar o restablecer contraseña devuelve solo `ok` y `message`.

La lista devuelve `data` como arreglo y `pagination` con `page`, `limit`, `total`, `totalPages`.
La página inicial es 1, el tamaño predeterminado es 20 y el máximo es 100.

Errores: `400` datos inválidos, `401` sesión requerida o inválida, `403` permisos
insuficientes (incluye intentar administrar una cuenta `ADMIN` sin ser `ROOT`),
`404` cuenta inexistente y `409` correo duplicado o intento de dejar el sistema sin `ROOT`.

## Verificación

Ejecutar `node --test test/system-users.test.js` y `node --test test/module-permissions.test.js`.
Las pruebas usan HTTP local, JWT y bcrypt reales con persistencia simulada;
no modifican PostgreSQL ni llaman al reloj. El bloqueo real de PostgreSQL requiere
una prueba de integración en una base de pruebas antes del despliegue.
