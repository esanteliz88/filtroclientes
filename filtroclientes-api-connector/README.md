# FiltroClientes API Connector (WordPress Plugin)

## Instalacion
1. Copia la carpeta `filtroclientes-api-connector` en `wp-content/plugins/`.
2. Activa el plugin desde WordPress.
3. Ve a `Settings > FiltroClientes API` y configura:
   - Base URL
   - Client ID
   - Client Secret

## Requisitos de permisos en API
El `client` configurado debe tener:
- scope: `read`
- permission: `GET ^/api/submissions$`

## Shortcode
Usa en una pagina:

`[filtroclientes_submissions limit="20" only_with_match="false"]`

Opcionales:
- `skip`
- `source_user_id`

Ejemplo:

`[filtroclientes_submissions limit="50" skip="0" only_with_match="true" source_user_id="123"]`

## Seguridad recomendada
Tambien puedes definir credenciales en `wp-config.php`:

```php
define('FILTROCLIENTES_API_BASE_URL', 'https://apiclientes.guiaysalud.com');
define('FILTROCLIENTES_API_CLIENT_ID', 'saga-api');
define('FILTROCLIENTES_API_CLIENT_SECRET', 'tu-secret');
```

Si defines constantes, el plugin las prioriza sobre la configuracion de base de datos.
