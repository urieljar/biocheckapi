# Errores, logs y monitoreo del reloj

## Errores

La API responde errores no controlados con un formato único:

```json
{
  "ok": false,
  "error": "INTERNAL_ERROR",
  "message": "Error interno del servidor",
  "requestId": "..."
}
```

El `requestId` aparece también en el encabezado `X-Request-Id` y en el log.
Los mensajes y stacks internos no se entregan al consumidor en producción.

## Logs

Cada solicitud HTTP, error de API, solicitud de integración y evento del reloj
se escribe en JSON Lines en `logs/api.log`. Las credenciales, JWT, contraseñas,
PIN y claves de comunicación se redactan automáticamente. Docker conserva el
directorio mediante el volumen `api_logs`.

## Monitoreo ZKTeco

Con `ZK_IP` configurada, el monitor se inicia automáticamente. Para controlar
el comportamiento explícitamente:

```env
DEVICE_MONITOR_ENABLED=true
DEVICE_MONITOR_INTERVAL_MS=60000
DEVICE_HEALTH_STALE_MINUTES=15
```

El monitor prueba conexión TCP y lectura de hora del reloj, actualiza
`lastConnectionAt` al responder correctamente y conserva el último estado
`UP`/`DOWN`, latencia, hora del dispositivo y error.

Consulta autenticada:

`GET /api/health/devices`

El endpoint no envía comandos ni modifica usuarios; únicamente prueba conexión
y lectura de hora. La sincronización de usuarios y checadas continúa en sus
procesos separados.
