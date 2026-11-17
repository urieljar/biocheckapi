# Migraciones de base de datos

El backend mantiene el historial en `schema_migrations`. Las migraciones se
ejecutan automáticamente al iniciar la API o de forma explícita con:

```powershell
npm run migrate
```

Para una instalación existente se conserva temporalmente `sequelize.sync()` y
los adaptadores `ensure...Schema` para no romper bases antiguas. Después de
confirmar que la base del servidor ya tiene el esquema inicial, configura:

```env
DB_SYNC=false
```

Desde ese momento, los cambios nuevos deben entrar en
`src/database/migrations/` y no mediante modificaciones manuales de tablas.

Antes de ejecutar una migración en el servidor:

1. Crear un respaldo de PostgreSQL.
2. Revisar el archivo de migración.
3. Ejecutar `npm run migrate` o reiniciar la API.
4. Verificar `/api/health`, login, ADMS y reportes.
