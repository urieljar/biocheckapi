# Roles y permisos de BioCheck

BioCheck tiene cuatro roles de cuenta, en escalera de privilegios:

```
CONSULTA  <  SUPERVISOR  <  ADMIN  <  ROOT
```

| Rol | Para quién | En una frase |
| --- | --- | --- |
| `ROOT` | Propietario del sistema | Todo, incluidas las cuentas `ADMIN` y `ROOT`. |
| `ADMIN` | TI / administración | Configura la operación y gestiona cuentas no privilegiadas; no toca `ROOT` ni `ADMIN`. |
| `SUPERVISOR` | Jefatura / RH | Opera el día a día: personal, horarios, catálogos, incidencias y checadas. |
| `CONSULTA` | Auditoría / dirección | Solo lectura de todo el sistema. |

Una cuenta nueva sin rol explícito se crea como `CONSULTA` (privilegio mínimo).

## Matriz de permisos

| Capacidad | Ruta que la aplica | ROOT | ADMIN | SUPERVISOR | CONSULTA |
| --- | --- | :--: | :--: | :--: | :--: |
| Consultar cualquier módulo | `GET` de todos los routers | ✅ | ✅ | ✅ | ✅ |
| Alta, edición y perfil de empleados | `POST/PATCH /api/employees/...` | ✅ | ✅ | ✅ | ❌ |
| Activar o desactivar empleados | `active` en `device-settings` | ✅ | ✅ | ✅ | ❌ |
| Descargar checadas del reloj | `POST /api/devices/sync-attendances` | ✅ | ✅ | ✅ | ❌ |
| Horarios y asignaciones | `POST/PATCH/DELETE /api/schedules`, `/api/employee-schedules` | ✅ | ✅ | ✅ | ❌ |
| Catálogos: departamentos, áreas, puestos | `POST/PATCH/DELETE /api/catalogs/:catalog` | ✅ | ✅ | ✅ | ❌ |
| Incidencias y festivos | `POST/PATCH/DELETE /api/calendar-exceptions` | ✅ | ✅ | ✅ | ❌ |
| Importar usuarios del reloj | `POST /api/devices/sync-users` | ✅ | ✅ | ❌ | ❌ |
| Gestionar cuentas `SUPERVISOR` y `CONSULTA` | `/api/users/...` | ✅ | ✅ | ❌ | ❌ |
| Gestionar cuentas `ADMIN` y `ROOT` | `/api/users/...` | ✅ | ❌ | ❌ | ❌ |
| Mi perfil y mi contraseña | `/api/auth/me`, `/api/auth/password` | ✅ | ✅ | ✅ | ✅ |

## Reglas de gestión de cuentas

- Un `ADMIN` puede crear, editar, desactivar y restablecer contraseñas solo de
  `SUPERVISOR` y `CONSULTA`. Si intenta operar sobre un `ADMIN` o un `ROOT`, recibe `403`.
- Un `ADMIN` **no ve** la cuenta `ROOT` en el listado ni en el detalle: la fila no aparece
  y `GET /api/users/:id` de esa cuenta responde `404`.
- Solo `ROOT` puede crear cuentas `ADMIN` o `ROOT` y modificarlas.
- No se puede desactivar ni degradar al **último `ROOT` activo** (`409`). Los cambios de
  cuentas se serializan con un bloqueo transaccional de PostgreSQL, así que dos bajas
  simultáneas no pueden dejar el sistema sin propietario.
- No hay eliminación física: se desactiva. Desactivar bloquea los tokens en la siguiente
  petición; reactivar permite reutilizar un token aún vigente.

## Dónde se cambian los permisos

La matriz vive en dos archivos espejo y **no** en las rutas:

- `backend/src/security/roles.js`: `ROLES`, `CAPABILITIES` y `hasCapability`.
- `frontend`: `fronted/src/lib/permissions.ts` (mismo mapa, para menú y guardas).

Para dar una capacidad nueva basta agregar la clave en ambos mapas y usar
`requireCapability('clave')` en la ruta. En el panel, `RequireCapability` protege la
pantalla y el menú la oculta si el rol no cumple.

## Cuentas anteriores al catálogo

Las cuentas creadas cuando solo existían `ADMIN` y `USER` conservan `USER` en PostgreSQL.
Mientras no se migren:

- el backend las trata como `SUPERVISOR` al evaluar permisos;
- el panel las muestra como `Supervisor`.

Para normalizar la tabla:

```bash
npm run migrate-roles                       # USER -> SUPERVISOR
npm run migrate-roles -- dueno@empresa.com  # además promueve esa cuenta a ROOT
npm run migrate-roles -- uno@empresa.com dos@empresa.com   # varias cuentas a ROOT
npm run create-admin                        # o crea/promueve la cuenta ROOT de .env
```

El primer `ROOT` se crea con `npm run create-admin` (`ADMIN_NAME`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`). Sin una cuenta `ROOT` activa nadie puede administrar `ADMIN`.

## Los roles del reloj son otra cosa

`employees.deviceRole` son los privilegios **dentro del checador**, no permisos del panel:

| Código | Nombre | Alcance en el MB160 |
| --- | --- | --- |
| 0 | Empleado | Solo checar |
| 2 | Registrador | Enrolar huellas o tarjetas de otros |
| 8 | Rol personalizado | Permisos definidos en el equipo |
| 12 | Administrador del sistema | Menú completo del equipo |
| 14 | Super administrador | Todo, incluida la clave de comunicación |

Un empleado con rol 14 en el reloj no obtiene acceso al panel. Nota: el comando ADMS
`DATA UPDATE USERINFO` solo distingue `14`; los demás se envían como `0`
(`backend/src/services/adms-command.service.js`).

## Verificación

```bash
cd backend && node --test          # incluye test/module-permissions.test.js
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx oxlint
```
