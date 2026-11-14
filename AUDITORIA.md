# Auditoría de BioCheck

## Qué registra

El backend crea la tabla `audit_logs` al iniciar y registra automáticamente:

- escrituras (`POST`, `PATCH`, `PUT`, `DELETE`), incluyendo altas, edición de expedientes, bajas, reingresos, eliminación recuperable, horarios, incidencias, usuarios, permisos y sincronizaciones;
- respuestas fallidas `4xx` y `5xx`, incluso consultas que fueron rechazadas;
- usuario autenticado (cuando existe), fecha, método, ruta, recurso, código HTTP, éxito/fallo, IP y navegador;
- un resumen sanitizado del cuerpo enviado y la duración de la petición.

Nunca se almacenan contraseñas, tokens, cookies, PINs, credenciales ni claves API. La auditoría no bloquea la operación principal si la base de datos está temporalmente caída.

## Consulta

Solo ROOT y ADMIN tienen la capacidad `audit.read` y pueden consultar:

```text
GET /api/audit-logs?page=1&limit=50
GET /api/audit-logs?category=ERROR&success=false
GET /api/audit-logs?actorId=<uuid>&from=2026-11-01&to=2026-12-01
```

En el frontend aparece **Sistema → Auditoría**. La consulta está paginada y permite filtrar acciones normales, errores, exitosas y fallidas.

## Retención recomendada

No se purgan registros automáticamente. Antes de definir una retención, exporta los reportes necesarios y acuerda con tu administración cuánto tiempo deben conservarse. No borres auditoría para corregir datos: registra una nueva corrección.

## Verificación local

1. Inicia PostgreSQL y el backend.
2. Inicia sesión como ROOT o ADMIN.
3. Abre **Sistema → Auditoría**.
4. Edita un expediente o intenta una operación inválida.
5. Actualiza la pantalla y verifica el usuario, resultado, ruta y fecha.
