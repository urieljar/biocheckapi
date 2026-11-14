# Piloto por VPN con Tailscale

Objetivo: acceder al proceso de integración desde otro equipo autorizado. La API
conserva su escucha en 127.0.0.1:3001. Tailscale Serve hace de proxy privado HTTPS.
No usar Funnel para esta prueba, ya que publicaría el servicio en internet.

## Preparación del equipo BioCheck

1. Instalar Tailscale y completar el inicio de sesión con tu cuenta.
2. Verificar el estado desde PowerShell:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' status
```

3. Mantener activa la API piloto. Si no está ejecutándose:

```powershell
Set-Location C:\opencode\biotimeuriel\backend
node src/scripts/demo-integration.js
```

Este comando mantiene la API en primer plano; dejar la terminal abierta. Al
reiniciarlo cambia la clave y se regenera la colección Postman local.

4. Antes de dar acceso a terceros, revisar Access controls en la consola Tailscale.
   Autorizar solo la identidad/equipo consumidor hacia este equipo en TCP 443.
   Revisar y retirar cualquier regla amplia que también permita otros puertos;
   agregar una regla específica no cancela permisos amplios existentes.
   No anunciar subredes ni configurar exit nodes para este piloto.
   La política concreta depende de las identidades de ambos equipos y no está
   aplicada por este documento.
5. Activar el proxy privado (requiere sesión iniciada):

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg http://127.0.0.1:3001
& 'C:\Program Files\Tailscale\tailscale.exe' serve status
```

Si el comando muestra un enlace para habilitar HTTPS, abrirlo con la cuenta dueña
de la red y completar el proceso. Guardar la URL HTTPS real devuelta por Serve.
Este documento no presupone que HTTPS o el proxy ya estén configurados.

## Equipo consumidor

Instalar Tailscale en el equipo que ejecutará el backend consumidor. Para probar
con un dispositivo propio, conectarlo a la misma red Tailscale. Para un tercero,
usar su propia cuenta, compartirle únicamente este equipo y aplicar la política
de acceso restringida; no compartir contraseñas de cuentas personales.

Importar `.local/integration-demo.postman_collection.json` en Postman y cambiar
la variable `baseUrl` por:

```text
https://NOMBRE-REAL-DEVUELTO-POR-SERVE/api/integrations/v1
```

Conservar la variable apiKey de la colección vigente. Ejecutar catálogo y cálculo.
Para comprobar acceso remoto, usar otro equipo conectado por una red distinta,
por ejemplo mediante el punto de acceso del teléfono.

Verificar desde el consumidor:

- Catálogo y cálculo con credencial: 200.
- Sin credencial: 401.
- `/api/users` en la URL HTTPS: 404 con credencial de integración.
- PostgreSQL y API interna: acceso denegado por política de red.

La prueba remota permanece pendiente hasta contar con un segundo equipo. Tailscale
no inicia ni supervisa Node: si se detiene el proceso piloto, el proxy no podrá
consultar la API. La computadora debe permanecer encendida y sin suspenderse.

## Si aparece 502 Bad Gateway

Si Tailscale está conectado y Serve apunta a localhost:3001, comprobar que el
proceso de integración esté activo. Serve no arranca la API de Node por sí solo.
Para reiniciar con la misma clave de Postman, ejecutar y dejar la terminal abierta:

```powershell
Set-Location C:\opencode\biotimeuriel\backend
node src/scripts/start-integration-local.js
```

Necesita PostgreSQL local en 5433 y las credenciales existentes en
`.local/integration-demo.credentials.json`. No usar el script demo para reiniciar
si se quiere mantener la clave: el script demo genera una nueva.
Este arranque no instala un servicio ni una tarea de inicio automático.

## Detener el proxy privado

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --https=443 off
```

Referencias:
- https://tailscale.com/docs/install/windows
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/features/sharing
