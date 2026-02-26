# Filtro API Base

Base robusta para API con autenticacion tipo `client_credentials`, permisos por scope y por endpoint, MongoDB, Redis cache, rate-limit y protecciones basicas de memoria.

## Requisitos
- Node.js 20+
- Docker/Docker Compose (opcional)

## Configuracion
1. Copia `.env.example` a `.env` y ajusta valores.
2. Asegura `JWT_SECRET` con al menos 32 caracteres.
3. Configura credenciales de documentacion privada (`DOCS_USERNAME`, `DOCS_PASSWORD`).

## Desarrollo local
```
npm install
npm run dev
```

## Docker
```
docker compose up --build
```

## Bootstrap de admin (sin secreto en .env)
El admin se crea una sola vez directamente en MongoDB y el secreto se muestra solo en consola:

```
npm run bootstrap:admin
```

Opcionalmente puedes definirlos manualmente:

```
npm run bootstrap:admin -- --client-id admin --secret "un-secreto-largo"
```

## Documentacion privada (OpenAPI + Swagger UI)
- `GET /docs` (protegido por Basic Auth)
- `GET /openapi.json` (protegido por Basic Auth)

## Flujo OAuth2 (client_credentials)
- Token:
```
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
```
[
  { "method": "GET", "path": "/api/data" },
  { "method": "POST", "path": "/api/.*" }
]
```

## Notas
- El admin ya no se crea con secretos en `.env`; usa `npm run bootstrap:admin`.
- Cache de ejemplo en `GET /api/data` con Redis (TTL 30s).
- Rate limit global: 200 req/min.
- Protección de memoria con `under-pressure`.
