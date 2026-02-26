import type { App } from '../app.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

function unauthorized(reply: FastifyReply) {
  reply.header('WWW-Authenticate', 'Basic realm="API Docs"');
  return reply.code(401).send({ error: 'unauthorized' });
}

function verifyBasicAuth(request: FastifyRequest, reply: FastifyReply, user: string, pass: string) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return unauthorized(reply);

  const base64 = header.slice(6).trim();
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return unauthorized(reply);

  const inUser = decoded.slice(0, sep);
  const inPass = decoded.slice(sep + 1);
  if (inUser !== user || inPass !== pass) return unauthorized(reply);
}

function buildOpenApi() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Filtro API',
      version: '0.1.0',
      description: 'API con OAuth2 client credentials, scopes y permisos por endpoint.'
    },
    servers: [{ url: 'http://localhost:3000' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': {
              description: 'OK'
            }
          }
        }
      },
      '/oauth/token': {
        post: {
          summary: 'Genera access token (client_credentials)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['grant_type', 'client_id', 'client_secret'],
                  properties: {
                    grant_type: { type: 'string', enum: ['client_credentials'] },
                    client_id: { type: 'string' },
                    client_secret: { type: 'string' },
                    scope: { type: 'string', example: 'read write' }
                  }
                },
                example: {
                  grant_type: 'client_credentials',
                  client_id: 'admin',
                  client_secret: '<your-admin-secret>',
                  scope: 'admin read write'
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Token emitido'
            },
            '400': { description: 'invalid_request' },
            '401': { description: 'invalid_client' }
          }
        }
      },
      '/admin/clients': {
        get: {
          summary: 'Lista clientes',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Lista de clientes' },
            '403': { description: 'admin_only' }
          }
        },
        post: {
          summary: 'Crea cliente API',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['clientId'],
                  properties: {
                    clientId: { type: 'string', minLength: 4 },
                    clientSecret: { type: 'string', minLength: 8 },
                    scopes: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['read']
                    },
                    permissions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['method', 'path'],
                        properties: {
                          method: { type: 'string', example: 'GET' },
                          path: { type: 'string', example: '/api/data' }
                        }
                      }
                    },
                    isAdmin: { type: 'boolean', default: false }
                  }
                },
                example: {
                  clientId: 'cliente-lectura',
                  scopes: ['read'],
                  permissions: [{ method: 'GET', path: '/api/data' }],
                  isAdmin: false
                }
              }
            }
          },
          responses: {
            '201': { description: 'Cliente creado' },
            '409': { description: 'client_exists' }
          }
        }
      },
      '/api/data': {
        get: {
          summary: 'Lectura protegida',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Data leida' },
            '403': { description: 'insufficient_scopes|not_allowed' }
          }
        },
        post: {
          summary: 'Escritura protegida',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Data escrita' },
            '403': { description: 'insufficient_scopes|not_allowed' }
          }
        }
      }
    }
  };
}

export async function registerDocs(app: App) {
  const docsUser = app.config.DOCS_USERNAME;
  const docsPass = app.config.DOCS_PASSWORD;
  const openapi = buildOpenApi();

  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = verifyBasicAuth(request, reply, docsUser, docsPass);
    if (result) return result;
  };

  app.get('/openapi.json', { preHandler: guard }, async () => openapi);

  app.get('/docs', { preHandler: guard }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Filtro API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui'
    });
  </script>
</body>
</html>`;

    reply.type('text/html').send(html);
  });
}
