# Identificación de empleados que no aparecen en el reloj

En Gestión de Personal, el botón **Verificar en reloj** consulta directamente
el reloj configurado y compara sus usuarios con los empleados de BioCheck
asociados al mismo dispositivo, usando `deviceUserId`, sin confundirlo con UID.

La lista muestra **Encontrado**, **No encontrado** o **Sin verificar**.
Las filas de empleados no encontrados se resaltan en rojo y muestran el aviso
junto al nombre. El selector **Mostrar empleados → No encontrados en el reloj**
permite consultar únicamente esos casos, con búsqueda y paginación propias sobre
todos los resultados de la verificación, sin limitarse a la página visible.
Primero se necesita pulsar **Verificar en reloj** para habilitar este filtro.
El resumen contiene todos los empleados no encontrados, aunque estén en otras
páginas de la tabla, y la fecha/hora de la lectura. El resultado corresponde a
esa lectura y permanece en la pantalla mientras se navega entre páginas; al
recargar la página o efectuar cambios del reloj se necesita verificar nuevamente.

La comprobación no importa usuarios, no envía empleados, no cambia nombres,
no marca bajas, no desactiva personas ni vincula checadas. No utiliza el flujo
`sync-users`, que tiene efectos de reconciliación distintos.

## API interna

`POST /api/devices/verify-employees`

Requiere Bearer de usuario interno y capacidad `employee.write`.
Por defecto: ROOT, ADMIN y SUPERVISOR; CONSULTA no ejecuta la lectura del reloj.
Esta ruta no se publica en la API externa de integración.

Devuelve dispositivo, checkedAt, clockUsers, total, found, missing y employees.
Cada empleado incluye solo id, deviceUserId, name y present.
No devuelve contraseñas, PIN, tarjetas ni plantillas biométricas.
Empleados asociados a otros dispositivos quedan sin verificar en la pantalla.

Si no se puede consultar el reloj o su lista está vacía o mal formada, devuelve
error sin marcar toda la plantilla como ausente. La lectura actual utiliza la
conexión directa configurada con ZK_IP/ZK_PORT; no acredita el funcionamiento ADMS.

La presencia indica coincidencia del número de usuario en el reloj, no que el
nombre, huella, rol o plantilla facial estén actualizados, ni que la persona esté
laboralmente activa. El estado `deviceSyncStatus` sigue siendo independiente.

## Verificación realizada

Se ejecutaron 53 pruebas del backend y compilación TypeScript/Vite y lint.
La lectura real local encontró 16 de 18 empleados. No encontró a:
- ANGELICA PATRICIA, 108070026.
- KEVIN SAUL, 108070016.

Este resultado es una instantánea y puede cambiar después de actualizar el reloj.
