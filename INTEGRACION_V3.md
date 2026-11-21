# Manual Técnico de Integración v3: Clock Gateway (ZKTeco)

La **Integración v3** de BioCheck es un **Gateway de Hardware Directo (Clock Gateway)** diseñado para permitir que cualquier sistema externo (ERP, CRM, software de nómina externo, control de acceso vehicular o peatonal) administre usuarios y extraiga checadas **directamente en la memoria física de los relojes checadores ZKTeco (ej. MB160)**.

---

## 1. Filosofía de Diseño: Zero-Storage

A diferencia de las versiones v1 y v2:
- **No crea empleados locales:** No altera las tablas de empleados (`employees`), perfiles (`employee_profiles`) ni expedientes de BioCheck (`storedInBioCheckEmployees: false`).
- **No contamina la base de datos de asistencia:** Las checadas descargadas por la v3 se devuelven directamente en formato JSON al sistema consumidor sin insertarse en PostgreSQL (`storedInBioCheck: false`).
- **El sistema externo es el dueño de la información:** Tu sistema externo mantiene el control maestro de nómina, colaboradores y turnos; BioCheck v3 actúa exclusivamente como el puente controlador del hardware biométrico.

```
+---------------------------+             +---------------------------+             +---------------------------+
|      Sistema Externo      |  HTTP REST  |     BioCheck Gateway      |  TCP / ADMS |       Reloj Físico        |
|  (ERP, Nómina, Accesos)   | ----------> |       v3 (:3001)          | ----------> |      ZKTeco (MB160)       |
+---------------------------+  (Bearer)   +---------------------------+ (Socket/Push+---------------------------+
                                                        |
                                          (No guarda en PostgreSQL)
```

---

## 2. Acceso, Red y Seguridad

### 2.1 URL Base y Puerto
El servicio de integración corre en el puerto dedicado **`3001`** (independiente de la API principal en el puerto 3000):

```http
http://<IP_SERVIDOR>:3001/api/integrations/v3
```

### 2.2 Autenticación
Todas las peticiones deben incluir el encabezado HTTP estándar `Authorization`:

```http
Authorization: Bearer <API_KEY_V3>
```

- **Clave privada actual:**  
  `fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860`  
  *(Almacenada en `.local/integration-v3.credentials.json`)*
- **Hash de validación en `.env`:**  
  `INTEGRATION_V3_API_KEY_SHA256=5b14ec629e45d740e1180e3348570015ead9071631b002a220d6eb045249d9f2`
- **Rotación de claves:** Para generar una nueva clave privada con su respectivo hash:
  ```powershell
  cd c:\opencode\biotimeuriel\biocheckapi
  node src/scripts/generate-integration-v3-key.js
  ```

### 2.3 Rate Limiting y Auditoría
- **Límite de tasa:** Máximo **60 peticiones por minuto**. Al superarlo devuelve `HTTP 429 Too Many Requests` con el encabezado `Retry-After: <segundos>`.
- **Auditoría:** Cada llamada se audita en la tabla `audit_logs` bajo la categoría `INTEGRATION_V3_CLOCK`.

---

## 3. Mecánica Crítica del Hardware ZKTeco

Para evitar bloqueos o errores de colisión en el reloj, el desarrollador del sistema externo debe respetar estas reglas:

### A. Diferencia entre `deviceUserId` y `deviceUid`
1. **`deviceUserId` (Identificador visible):** Es el código que la persona digita en el teclado o el ID de empleado (string de hasta 50 caracteres, ej: `"108070050"`).
2. **`deviceUid` (Índice de memoria interno):** Es un número entero obligatorio **entre 1 y 65535** que ZKTeco utiliza internamente como puntero de memoria.
   > **Importante:** El sistema externo debe garantizar que cada nuevo usuario tenga un `deviceUid` único en ese reloj. Si envía un `deviceUid` duplicado, la API responderá `HTTP 409 Conflict`.  
   > *Estrategia recomendada:* Consultar `GET /devices/:id/clock-users` y asignar el número siguiente disponible.

### B. Canales de Comunicación Híbridos (TCP directo vs ADMS)
La v3 decide automáticamente el canal según la longitud del identificador:
- **`deviceUserId.length <= 8` (TCP Directo - Socket 4370):**  
  Se conecta de inmediato por socket TCP con el reloj, escribe el registro y valida físicamente que quedó guardado. Devuelve `HTTP 201 Created` (`status: "VERIFIED"`).
- **`deviceUserId.length > 8` (ADMS Push):**  
  Los relojes ZKTeco limitan el buffer de comandos TCP rápidos para IDs largos. La v3 lo encola automáticamente vía ADMS y devuelve `HTTP 202 Accepted` con un `operationId`. El sistema externo consulta `GET /device-operations/:operationId` para confirmar cuándo el reloj reportó `status: "SUCCESS"`.

### C. Enrolamiento de Huellas Dactilares y Rostros
La API crea y actualiza la ficha del usuario en el reloj (Nombre, ID, PIN y Tarjeta RFID). La captura de huellas dactilares o reconocimiento facial se realiza físicamente en el reloj: una vez dado de alta por la API, la persona se para frente al reloj y el supervisor le registra sus biométricos asociándolos a su `deviceUserId`.

---

## 4. Catálogo Detallado de Endpoints

### 4.1 Dispositivos y Diagnóstico

#### Listar Relojes Checadores
```http
GET /api/integrations/v3/devices
```
**Respuesta `200 OK`:**
```json
{
  "ok": true,
  "data": [
    {
      "deviceId": "51f28b78-43d9-487d-8153-623253b27b96",
      "name": "MB160",
      "ip": "192.168.1.201",
      "port": 4370,
      "serialNumber": "AYK8254800080",
      "active": true,
      "admsStatus": "CONNECTED",
      "lastConnectionAt": "2026-11-20T17:40:00.000Z",
      "lastAdmsAt": "2026-11-20T17:40:15.000Z"
    }
  ],
  "total": 1
}
```

#### Consultar Estado de Conectividad
```http
GET /api/integrations/v3/devices/:deviceId/status
```

#### Probar Conexión TCP (Ping al Reloj)
```http
POST /api/integrations/v3/devices/:deviceId/test-connection
```
**Respuesta `200 OK`:**
```json
{
  "ok": true,
  "data": {
    "deviceId": "51f28b78-43d9-487d-8153-623253b27b96",
    "connected": true,
    "transport": "TCP",
    "ip": "192.168.1.201",
    "port": 4370,
    "deviceTime": "2026-11-20T17:42:00.000Z",
    "checkedAt": "2026-11-20T17:42:01.000Z"
  }
}
```

---

### 4.2 Gestión de Usuarios en el Reloj (Clock Users)

#### Listar Todos los Usuarios del Reloj
Descarga la lista de usuarios que residen en la memoria física del reloj:
```http
GET /api/integrations/v3/devices/:deviceId/clock-users
```
**Respuesta `200 OK`:**
```json
{
  "ok": true,
  "data": [
    {
      "deviceUserId": "108070014",
      "deviceUid": 14,
      "name": "CARLOS ARAMBURO",
      "deviceRole": 0,
      "devicePin": "1234",
      "cardNumber": null
    }
  ],
  "total": 1,
  "source": "CLOCK",
  "storedInBioCheckEmployees": false
}
```

#### Consultar Usuario Específico en el Reloj
```http
GET /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
```

#### Crear Usuario en el Reloj
```http
POST /api/integrations/v3/devices/:deviceId/clock-users
Content-Type: application/json

{
  "deviceUserId": "108070099",
  "deviceUid": 99,
  "name": "MARIA GONZALEZ",
  "deviceRole": 0,
  "devicePin": "5678",
  "cardNumber": null
}
```
**Campos del Payload:**
- `deviceUserId` *(string, requerido, máx 50)*: Identificador visible del empleado.
- `deviceUid` *(entero, requerido, 1..65535)*: Índice único en la memoria del ZKTeco.
- `name` *(string, requerido, máx 160)*: Nombre que mostrará la pantalla del reloj.
- `deviceRole` *(entero, opcional, default 0)*:
  - `0`: Usuario normal / Empleado
  - `2`: Registrador
  - `8`: Rol personalizado
  - `14`: Super Administrador
- `devicePin` *(string numérico, opcional, máx 20 dígitos)*: PIN de marcación o `null`.
- `cardNumber` *(string numérico, opcional, máx 50 dígitos)*: Número de tarjeta RFID o `null`.

**Respuesta para IDs <= 8 caracteres (`201 Created` - TCP):**
```json
{
  "ok": true,
  "message": "Usuario creado y verificado en el reloj",
  "data": {
    "deviceId": "51f28b78-...",
    "deviceUserId": "108070099",
    "deviceUid": 99,
    "name": "MARIA GONZALEZ",
    "deviceRole": 0,
    "transport": "TCP",
    "status": "VERIFIED",
    "storedInBioCheckEmployees": false
  }
}
```

**Respuesta para IDs > 8 caracteres (`202 Accepted` - ADMS):**
```json
{
  "ok": true,
  "message": "Usuario encolado para el reloj por ADMS",
  "data": {
    "deviceId": "51f28b78-...",
    "deviceUserId": "108070099",
    "deviceUid": 99,
    "name": "MARIA GONZALEZ",
    "deviceRole": 0,
    "transport": "ADMS",
    "operationId": "412",
    "status": "PENDING",
    "storedInBioCheckEmployees": false
  }
}
```

#### Actualizar Usuario en el Reloj
Modifica los datos sin alterar el `deviceUserId` ni el `deviceUid`:
```http
PATCH /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
Content-Type: application/json

{
  "name": "MARIA GONZALEZ PEREZ",
  "deviceRole": 0,
  "devicePin": "9999",
  "cardNumber": null
}
```

#### Retirar Usuario del Reloj (Elimina Usuario y Biométricos)
Borra la ficha del empleado y **elimina permanentemente sus huellas dactilares y rostros** del dispositivo físico:
```http
DELETE /api/integrations/v3/devices/:deviceId/clock-users/:deviceUserId
Content-Type: application/json

{
  "confirmationDeviceUserId": "108070099"
}
```
**Respuesta `200 OK` (TCP) / `202 Accepted` (ADMS):**
```json
{
  "ok": true,
  "message": "Usuario retirado y verificado en el reloj. Sus biométricos fueron eliminados del dispositivo.",
  "data": {
    "deviceId": "51f28b78-...",
    "deviceUserId": "108070099",
    "deviceUid": 99,
    "transport": "TCP",
    "status": "VERIFIED",
    "storedInBioCheckEmployees": false
  }
}
```

#### Verificar Presencia Física en el Reloj
Comprueba si un usuario existe (`EXISTS`) o está ausente (`ABSENT`) en el dispositivo:
```http
POST /api/integrations/v3/devices/:deviceId/clock-users/verify
Content-Type: application/json

{
  "deviceUserId": "108070099",
  "expected": "EXISTS"
}
```

---

### 4.3 Descarga Directa de Checadas (Attendances Sync)

Extrae el registro en crudo de las marcaciones almacenadas en la memoria del reloj checador:
```http
POST /api/integrations/v3/devices/:deviceId/attendances/sync
```

**Respuesta `200 OK`:**
```json
{
  "ok": true,
  "message": "Checadas descargadas directamente del reloj",
  "data": {
    "deviceId": "51f28b78-43d9-487d-8153-623253b27b96",
    "received": 2,
    "events": [
      {
        "deviceId": "51f28b78-43d9-487d-8153-623253b27b96",
        "deviceUserId": "108070014",
        "deviceUserSn": 14,
        "recordTime": "2026-11-20T08:01:23.000Z",
        "deviceIp": "192.168.1.201",
        "source": "CLOCK"
      },
      {
        "deviceId": "51f28b78-43d9-487d-8153-623253b27b96",
        "deviceUserId": "108070035",
        "deviceUserSn": 35,
        "recordTime": "2026-11-20T08:05:10.000Z",
        "deviceIp": "192.168.1.201",
        "source": "CLOCK"
      }
    ],
    "source": "CLOCK",
    "storedInBioCheck": false
  }
}
```

> **Nota de concurrencia:** Si en ese exacto segundo BioCheck está ejecutando una sincronización interna automática, responderá `HTTP 409 Conflict: Ya hay una sincronización de checadas en curso`. El cliente externo debe esperar 5 segundos y reintentar.

---

### 4.4 Monitoreo de Operaciones Asíncronas ADMS

Para operaciones que devolvieron `HTTP 202 Accepted` (`operationId`):
```http
GET /api/integrations/v3/device-operations/:operationId
```
**Respuesta `200 OK`:**
```json
{
  "ok": true,
  "data": {
    "operationId": "412",
    "deviceId": "51f28b78-...",
    "status": "SUCCESS",
    "transport": "ADMS",
    "attempts": 1,
    "maxAttempts": 5,
    "error": null,
    "createdAt": "2026-11-20T17:45:00.000Z",
    "sentAt": "2026-11-20T17:45:05.000Z",
    "confirmedAt": "2026-11-20T17:45:06.000Z"
  }
}
```

---

## 5. Tabla de Códigos de Respuesta HTTP

| Código | Mensaje típico | Causa y Acción recomendada |
| :---: | :--- | :--- |
| **`200`** | `OK` | Consulta o actualización exitosa. |
| **`201`** | `Created` | Usuario creado y verificado por TCP directo en el hardware. |
| **`202`** | `Accepted` | Operación encolada vía ADMS. Consultar `device-operations/:id`. |
| **`400`** | `Bad Request` | JSON inválido, UID fuera de rango (1..65535) o caracteres prohibidos. |
| **`401`** | `Unauthorized` | Token Bearer faltante o inválido. |
| **`404`** | `Not Found` | Dispositivo no activo o usuario no encontrado en el reloj. |
| **`409`** | `Conflict` | `deviceUid` o `deviceUserId` ya existen en el reloj, o sync ocupado. |
| **`429`** | `Too Many Requests` | Excedió el límite de 60 req/min. Esperar los segundos de `Retry-After`. |
| **`502`** | `Bad Gateway` | Reloj ZKTeco apagado, cable desconectado o socket TCP saturado. |

---

## 6. Ejemplos de Implementación en Código

### 6.1 Python (requests)
```python
import requests

BASE_URL = "http://127.0.0.1:3001/api/integrations/v3"
API_KEY = "fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# 1. Obtener deviceId
devices = requests.get(f"{BASE_URL}/devices", headers=HEADERS).json()["data"]
device_id = devices[0]["deviceId"]

# 2. Crear usuario en el reloj
nuevo_usuario = {
    "deviceUserId": "108070099",
    "deviceUid": 99,
    "name": "ROBERTO SANCHEZ",
    "deviceRole": 0,
    "devicePin": "1234",
    "cardNumber": None
}
resp = requests.post(f"{BASE_URL}/devices/{device_id}/clock-users", json=nuevo_usuario, headers=HEADERS, timeout=15)
print(resp.json())

# 3. Descargar checadas directas
checadas = requests.post(f"{BASE_URL}/devices/{device_id}/attendances/sync", headers=HEADERS, timeout=15).json()
print(f"Checadas recibidas: {checadas['data']['received']}")
```

### 6.2 Node.js / JavaScript (Fetch nativo)
```javascript
const BASE_URL = 'http://127.0.0.1:3001/api/integrations/v3';
const API_KEY = 'fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860';
const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

async function main() {
  // 1. Obtener relojes
  const devRes = await fetch(`${BASE_URL}/devices`, { headers });
  const { data: devices } = await devRes.json();
  const deviceId = devices[0].deviceId;

  // 2. Descargar checadas en crudo
  const syncRes = await fetch(`${BASE_URL}/devices/${deviceId}/attendances/sync`, {
    method: 'POST',
    headers
  });
  const syncData = await syncRes.json();
  console.log('Checadas del reloj:', syncData.data.events);
}
main().catch(console.error);
```

### 6.3 cURL (Consola / Bash)
```bash
# Listar dispositivos
curl -s -X GET "http://127.0.0.1:3001/api/integrations/v3/devices" \
  -H "Authorization: Bearer fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860"

# Descargar checadas en vivo
curl -s -X POST "http://127.0.0.1:3001/api/integrations/v3/devices/<DEVICE_ID>/attendances/sync" \
  -H "Authorization: Bearer fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860"
```

---

## 7. Pruebas Interactivas con Postman

El proyecto incluye la colección oficial lista para importar:
- **Archivo:** `biocheckapi/INTEGRACION_V3_POSTMAN.json`

**Pasos para usarla:**
1. Abre Postman > Clic en **Import** > Selecciona `biocheckapi/INTEGRACION_V3_POSTMAN.json`.
2. En las variables de la colección confirma:
   - `baseUrl`: `http://127.0.0.1:3001` (o la IP del servidor).
   - `apiKeyV3`: `fc2d1df3628269d00d41e10a97e7de0e640ba7c9ebe5ab2e9c83d52e56f85860`
3. Ejecuta la petición **«Listar dispositivos»** para obtener el `deviceId` y cópialo en la variable `deviceId` de Postman para probar cualquier petición con un clic.

---

## 8. Recomendaciones de Despliegue en Producción

1. **Aislamiento de Red:**
   - Si el sistema externo está en la misma red local o VPN (Tailscale): conectar directamente al puerto `3001`.
   - Si el sistema externo está en internet público / nube: **No abras el puerto 3001 directo a internet**. Utiliza un proxy inverso con **HTTPS y certificado SSL** (Nginx, Caddy o Cloudflare Tunnel) que reciba el tráfico en el puerto 443 y lo redirija internamente a `127.0.0.1:3001`.
2. **Timeouts en el Cliente:**
   - La comunicación por socket TCP con el hardware físico ZKTeco puede demorar entre 1 y 4 segundos dependiendo de la red. Configura un timeout en tu cliente HTTP de al menos **15 segundos**.
3. **Procesamiento Secuencial:**
   - Los relojes ZKTeco solo aceptan 1 o 2 conexiones concurrentes en su puerto 4370. Ejecuta las peticiones hacia el mismo reloj de forma secuencial (una tras otra) para evitar saturar el hardware.
