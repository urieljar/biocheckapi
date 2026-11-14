# Expediente ampliado

El expediente se organiza en cuatro secciones:

- Perfil y organización: nombres, apellidos, número de empleado y catálogos.
- Información personal: identificación, NSS, nacimiento, teléfonos, correo y domicilio.
  Pasaporte y licencias son opcionales.
- Información laboral: tipo de empleo, ingreso y datos de baja.
- Asistencia: consulta de horarios asignados, días y vigencias registradas.

No incluye fotografías, documentos ni control de vacaciones.

## API

Se conservan los endpoints existentes:

- `GET /api/employees/:id/profile`
- `POST /api/employees/:id/profile`
- `PATCH /api/employees/:id/profile`

Requieren autenticación; la escritura exige `employee.write`.
Los campos agregados son:

```json
{
  "employmentStatus": "TERMINATED",
  "terminationDate": "2026-11-13",
  "terminationReason": "Renuncia"
}
```

`employmentStatus` acepta `ACTIVE`, `TERMINATED` o `null` (sin registrar).
No se infiere el estado laboral a partir de la presencia de la persona en el reloj.
La baja requiere fecha real y motivo. Su fecha no puede ser anterior al ingreso.
Para corregir una baja y registrar a la persona en servicio:

```json
{
  "employmentStatus": "ACTIVE",
  "terminationDate": null,
  "terminationReason": null
}
```

Los cambios parciales se validan contra el expediente existente. Estos campos
guardan información laboral; no cambian `Employee.active`, no eliminan usuarios
del reloj y no incorporan por sí solos filtros históricos nuevos al cálculo de
pre-nómina. Esas operaciones pertenecen a sus respectivos flujos.

Los nombres del expediente son independientes del nombre enviado al dispositivo.
Los campos no incluidos en el formulario, como `religion`, no se sobrescriben.

La sección Asistencia consulta:
`GET /api/employee-schedules?employeeId=:id&all=true`.
Solo muestra las asignaciones que aún existen; no recupera registros borrados
ni sustituye el trabajo pendiente de versionado de horarios.

## Instalaciones existentes

`ensureProfileCatalogSchema` llama a `ensureProfileEmploymentSchema` durante el
arranque normal de la API. Agrega tres columnas con `ADD COLUMN IF NOT EXISTS`,
sin rellenar ni cambiar valores de expedientes previos. Para otra instalación,
reiniciar el backend con el código actualizado aplica esta ampliación.

## Validación

- Pruebas HTTP de creación, consulta, actualización, bajas, fechas y permisos.
- Guardado y lectura en PostgreSQL real dentro de una transacción revertida.
- TypeScript, compilación Vite y lint de los archivos modificados del frontend.
- Verificación visual pendiente: la herramienta de control de Chrome bloqueó
  la sesión al no poder identificar la URL con suficiente certeza.
