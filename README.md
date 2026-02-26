# Filtro API Base

Base robusta para API con autenticacion tipo `client_credentials`, permisos por scope y por endpoint, MongoDB, Redis cache opcional, rate-limit y protecciones basicas de memoria.

## Requisitos
- Node.js 20+
- Docker/Docker Compose (opcional)

## Configuracion
1. Copia `.env.example` a `.env` y ajusta valores.
2. Asegura `JWT_SECRET` con al menos 32 caracteres.
3. Configura credenciales de documentacion privada (`DOCS_USERNAME`, `DOCS_PASSWORD`).
4. Redis opcional:
   - `ENABLE_REDIS=true`: usa `REDIS_URL` (por defecto `redis://127.0.0.1:6379`).
   - `ENABLE_REDIS=false`: la API corre sin Redis.

## Desarrollo local
```bash
npm install
npm run dev
```

## Docker
```bash
docker compose up --build
```

El `Dockerfile` principal inicia Redis interno para despliegues de contenedor unico.

## Bootstrap de admin (sin secreto en .env)
El admin se crea una sola vez directamente en MongoDB y el secreto se muestra solo en consola:

```bash
npm run bootstrap:admin
```

Opcionalmente puedes definirlos manualmente:

```bash
npm run bootstrap:admin -- --client-id admin --secret "un-secreto-largo"
```

## Documentacion privada (OpenAPI + Swagger UI)
- `GET /docs` (protegido por Basic Auth)
- `GET /openapi.json` (protegido por Basic Auth)

## Flujo OAuth2 (client_credentials)
- Token:
```http
POST /oauth/token
{
  "grant_type": "client_credentials",
  "client_id": "<admin-client-id>",
  "client_secret": "<admin-client-secret>",
  "scope": "read write"
}
```

## Endpoints principales
- `POST /oauth/token`
- `POST /admin/clients` (requiere token admin)
- `GET /admin/clients` (requiere token admin)
- `GET /api/data` (scope `read` + permiso por endpoint)
- `POST /api/data` (scope `write` + permiso por endpoint)

## Permisos
- `scopes`: validacion rapida por tipo (read/write/admin).
- `permissions`: lista de `{ method, path }` usando regex para controlar endpoints especificos.

Ejemplo de permisos:
```json
[
  { "method": "GET", "path": "/api/data" },
  { "method": "POST", "path": "/api/.*" }
]
```

## Notas
- El admin ya no se crea con secretos en `.env`; usa `npm run bootstrap:admin`.
- Cache de ejemplo en `GET /api/data` con Redis (TTL 30s) cuando Redis esta habilitado.
- Rate limit global: 200 req/min.
- Proteccion de memoria con `under-pressure`.
