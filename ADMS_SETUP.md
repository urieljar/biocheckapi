# Configuración ADMS

El backend expone ADMS bajo el prefijo `/iclock`.

Con la red local actual, configura el checador con:

- Servidor ADMS: `192.168.1.35`
- Puerto: `3000`
- Ruta o endpoint: `/iclock`
- Número de serie: `AYK8254800080`
- Transporte: HTTP

El reloj debe poder alcanzar `http://192.168.1.35:3000/iclock/cdata`.
Si el backend está dentro de Docker, el puerto `3000` debe estar publicado en el host y el firewall de Windows debe permitir conexiones entrantes desde la red privada.

Para comprobar la conexión desde el reloj, revisa los logs de la API y busca:

- `[ADMS] handshake`
- `[ADMS] getrequest`
- `[ADMS] devicecmd`

El endpoint de prueba es:

```text
GET http://192.168.1.35:3000/api/health
```

La API debe responder JSON con `ok: true`. La configuración del reloj no se puede aplicar desde el backend: debe capturarse en el menú de comunicación/ADMS del dispositivo.
