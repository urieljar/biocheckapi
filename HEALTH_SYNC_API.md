# Salud de la API y sincronización con el reloj

## Salud general

`GET /api/health`

No requiere JWT. Devuelve disponibilidad, conexión de PostgreSQL, tiempo activo y el último estado conocido de los trabajos automáticos. No realiza una conexión física al reloj en cada consulta.

`GET /api/health/ready`

No requiere JWT. Es el endpoint de readiness usado por Docker y devuelve `200` solo cuando PostgreSQL responde; si la base no está disponible devuelve `503`.

`GET /api/health/devices`

Requiere `Authorization: Bearer <JWT de usuario>`. Devuelve los relojes activos, la última conexión registrada y si ese dato está obsoleto. La dirección IP no se publica sin autenticación.

## Estado de un empleado hacia el reloj

Interno, con JWT:

`GET /api/employees/:id/sync-status`

Externo, con el token de lectura de integración:

`GET /api/integrations/v2/employees/:employeeId/sync-status`

Respuesta de ejemplo:

```json
{
  "ok": true,
  "data": {
    "employeeId": "uuid",
    "employeeNumber": "108070017",
    "name": "ABRIL",
    "active": true,
    "status": "SYNCED",
    "error": null,
    "syncedAt": "2026-11-16T18:00:00.000Z",
    "device": {
      "id": "uuid",
      "name": "MB160",
      "ip": "192.168.1.201",
      "port": 4370,
      "lastConnectionAt": "2026-11-16T18:01:00.000Z"
    }
  }
}
```

`status` puede ser `PENDING`, `SYNCED` o `ERROR`. `PENDING` significa que el cambio quedó registrado pero todavía no se confirmó la reconciliación con el reloj; `ERROR` incluye el último mensaje en `error`.

El estado no debe interpretarse como una confirmación biométrica individual: confirma la sincronización del usuario del reloj. La verificación de huella/rostro continúa dependiendo del dispositivo.
