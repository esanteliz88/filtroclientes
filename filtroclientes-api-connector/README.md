# FiltroClientes Connector Pro

Plugin WordPress con:
- CPT `fc_submission` para almacenar registros sincronizados desde API.
- Panel admin con Dashboard, Configuracion y Registros.
- Sincronizacion manual desde `/api/submissions`.
- Shortcode para mostrar tabla de registros.

## Estructura
- `filtroclientes-api-connector.php` bootstrap
- `includes/` clases (settings, API client, CPT, sync, admin, shortcode)
- `assets/css/admin.css` estilo admin

## Instalacion
1. Copiar carpeta `filtroclientes-api-connector` a `wp-content/plugins/`.
2. Activar plugin.
3. Ir a `FiltroClientes > Conexion API`.
4. Configurar:
   - Base URL
   - Client ID
   - Client Secret
   - Limite sync
   - Portal Email (super admin)
   - Portal Password

## Permisos requeridos en API
El client configurado en WP debe tener:
- scope: `read`
- permissions:
  - `GET ^/api/submissions$`

## Sincronizar
Ir a `FiltroClientes > Dashboard` y hacer click en **Sincronizar ahora**.

## Shortcode
`[filtroclientes_registros limit="20"]`

## Seguridad recomendada
Definir secretos en `wp-config.php`:

```php
define('FILTROCLIENTES_API_BASE_URL', 'https://apiclientes.guiaysalud.com');
define('FILTROCLIENTES_API_CLIENT_ID', 'saga-api');
define('FILTROCLIENTES_API_CLIENT_SECRET', 'tu-secret');
```

Las constantes tienen prioridad sobre settings guardados.

Opcional (portal super admin):
```php
define('FILTROCLIENTES_PORTAL_EMAIL', 'superadmin@dominio.com');
define('FILTROCLIENTES_PORTAL_PASSWORD', 'tu-clave');
```
