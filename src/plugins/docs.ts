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

function buildOpenApi(port: number) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Filtro API',
      version: '0.2.0',
      description:
        'API con OAuth2 client_credentials, scopes, permisos por URL/metodo y webhook QillForms con normalizacion.'
    },
    servers: [{ url: `http://localhost:${port}` }],
    tags: [
      { name: 'System' },
      { name: 'Auth' },
      { name: 'Admin' },
      { name: 'Protected' },
      { name: 'Webhooks' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        Permission: {
          type: 'object',
          required: ['method', 'path'],
          properties: {
            method: { type: 'string', example: 'POST' },
            path: { type: 'string', example: '^/webhooks/qillform$' }
          }
        }
      }
    },
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  example: { status: 'ok' }
                }
              }
            }
          }
        }
      },
      '/oauth/token': {
        post: {
          tags: ['Auth'],
          summary: 'Genera access token (client_credentials)',
          description:
            'Si envias `scope`, todos deben estar permitidos en el cliente. Si uno no corresponde, retorna `invalid_scope`.',
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
                    scope: { type: 'string', example: 'write read' }
                  }
                },
                examples: {
                  admin: {
                    value: {
                      grant_type: 'client_credentials',
                      client_id: 'admin',
                      client_secret: '<admin-secret>',
                      scope: 'admin write read'
                    }
                  },
                  service: {
                    value: {
                      grant_type: 'client_credentials',
                      client_id: 'qillform-client',
                      client_secret: '<service-secret>',
                      scope: 'write'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Token emitido',
              content: {
                'application/json': {
                  example: {
                    access_token: '<jwt>',
                    token_type: 'bearer',
                    expires_in: 3600,
                    scope: 'write read'
                  }
                }
              }
            },
            '400': {
              description: 'invalid_request | invalid_scope',
              content: {
                'application/json': {
                  examples: {
                    invalidRequest: { value: { error: 'invalid_request' } },
                    invalidScope: {
                      value: { error: 'invalid_scope', invalid_scopes: ['admin'] }
                    }
                  }
                }
              }
            },
            '401': {
              description: 'invalid_client',
              content: {
                'application/json': {
                  example: { error: 'invalid_client' }
                }
              }
            }
          }
        }
      },
      '/admin/clients': {
        get: {
          tags: ['Admin'],
          summary: 'Lista clientes',
          description: 'Requiere token con privilegios admin.',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Lista de clientes' },
            '401': { description: 'unauthorized' },
            '403': { description: 'admin_only' }
          }
        },
        post: {
          tags: ['Admin'],
          summary: 'Crea cliente API',
          description:
            'Define scopes y permisos por URL/metodo (regex). Requiere token admin.',
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
                      items: { type: 'string', enum: ['read', 'write', 'admin'] }
                    },
                    permissions: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Permission' }
                    },
                    isAdmin: { type: 'boolean', default: false }
                  }
                },
                example: {
                  clientId: 'qillform-client',
                  clientSecret: 'qillformSecret123',
                  scopes: ['write', 'read'],
                  permissions: [
                    { method: 'POST', path: '^/webhooks/qillform$' },
                    { method: 'GET', path: '^/api/data$' }
                  ],
                  isAdmin: false
                }
              }
            }
          },
          responses: {
            '201': { description: 'Cliente creado' },
            '401': { description: 'unauthorized' },
            '403': { description: 'admin_only' },
            '409': { description: 'client_exists' }
          }
        }
      },
      '/api/data': {
        get: {
          tags: ['Protected'],
          summary: 'Lectura protegida',
          description: 'Requiere `auth=true`, scope `read` y permiso GET sobre esta URL.',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Data leida' },
            '401': { description: 'unauthorized' },
            '403': { description: 'insufficient_scopes | not_allowed' }
          }
        },
        post: {
          tags: ['Protected'],
          summary: 'Escritura protegida',
          description: 'Requiere `auth=true`, scope `write` y permiso POST sobre esta URL.',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Data escrita' },
            '401': { description: 'unauthorized' },
            '403': { description: 'insufficient_scopes | not_allowed' }
          }
        }
      },
      '/webhooks/qillform': {
        post: {
          tags: ['Webhooks'],
          summary: 'Ingesta QillForms (normaliza y guarda)',
          description:
            'Requiere token Bearer, scope `write` y permiso `POST ^/webhooks/qillform$`. Acepta `subtipo_*` dinamico y normaliza campos.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true
                },
                example: {
                  derivador: '1',
                  enfermedad: 'cancer',
                  tipo_enfermedad: 'Pulmón',
                  subtipo_pulmon: 'Células NO pequeñas',
                  sexo: 'Masculino',
                  region: 'I. Tarapaca',
                  ciudad: 'Santiago',
                  metastasis: 'Si',
                  cirugia: 'Si',
                  cirugia_fecha: '27/12/2023',
                  cirugia_descripcion: 'Descripcion de cirugía',
                  tratamiento: 'Si',
                  tratamiento_tipo:
                    'Quimioterapia,Radioterapia,Inmunoterapia,Terapia Hormonal,Terapia Dirigida,No estoy seguro/a',
                  ecog_dolor: 'No tengo dolor',
                  ecog_descanso: 'Solo en la noche',
                  ecog_ayuda: 'No necesito ayuda',
                  contacto_nombre: 'Andrés Prueba Reyes',
                  contacto_email: 'areyes@vitzana.com',
                  contacto_telefono: '+56957600539',
                  consentimiento: 'Si',
                  entry_id: 25,
                  form_id: '11',
                  entry_date: '2026-02-26 14:06:18',
                  user_id: 1,
                  user_ip: '2800:300:6a73:3900:b163:5db8:9922:f356',
                  centro: 'saga,bh,faizer'
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Guardado exitoso',
              content: {
                'application/json': {
                  example: {
                    ok: true,
                    id: '65af0000abc1230000000000',
                    normalized: {
                      tipo_enfermedad: 'Pulmón',
                      subtipo_enfermedad: 'Células NO pequeñas',
                      subtipo_clave: 'subtipo_pulmon',
                      tratamiento_tipo: [
                        'Quimioterapia',
                        'Radioterapia',
                        'Inmunoterapia',
                        'Terapia Hormonal',
                        'Terapia Dirigida',
                        'No estoy seguro/a'
                      ],
                      centro: ['saga', 'bh', 'pfizer']
                    }
                  }
                }
              }
            },
            '400': { description: 'invalid_request' },
            '401': { description: 'unauthorized' },
            '403': { description: 'insufficient_scopes | not_allowed' }
          }
        }
      }
    }
  };
}

export async function registerDocs(app: App) {
  const docsUser = app.config.DOCS_USERNAME;
  const docsPass = app.config.DOCS_PASSWORD;
  const openapi = buildOpenApi(app.config.PORT);

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
