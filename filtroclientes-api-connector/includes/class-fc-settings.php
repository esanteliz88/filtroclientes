<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Settings
{
    public const OPTION_KEY = 'fc_api_settings';
    public const TOKEN_TRANSIENT = 'fc_api_access_token';
    public const PORTAL_TOKEN_TRANSIENT = 'fc_portal_access_token';
    public const PORTAL_ROLE_TRANSIENT = 'fc_portal_role';

    public static function register_settings(): void
    {
        register_setting(
            'fc_api_group',
            self::OPTION_KEY,
            [
                'sanitize_callback' => [self::class, 'sanitize']
            ]
        );
    }

    public static function sanitize($input): array
    {
        if (!is_array($input)) {
            return self::defaults();
        }

        return [
            'base_url' => isset($input['base_url']) ? esc_url_raw(rtrim((string) $input['base_url'], '/')) : '',
            'client_id' => isset($input['client_id']) ? sanitize_text_field((string) $input['client_id']) : '',
            'client_secret' => isset($input['client_secret']) ? sanitize_text_field((string) $input['client_secret']) : '',
            'default_limit' => isset($input['default_limit']) ? max(1, min(200, (int) $input['default_limit'])) : 50,
            'portal_email' => isset($input['portal_email']) ? sanitize_email((string) $input['portal_email']) : '',
            'portal_password' => isset($input['portal_password']) ? sanitize_text_field((string) $input['portal_password']) : ''
        ];
    }

    public static function defaults(): array
    {
        return [
            'base_url' => '',
            'client_id' => '',
            'client_secret' => '',
            'default_limit' => 50,
            'portal_email' => '',
            'portal_password' => ''
        ];
    }

    public static function get(): array
    {
        $saved = get_option(self::OPTION_KEY, self::defaults());
        if (!is_array($saved)) {
            $saved = self::defaults();
        }

        $baseUrl = defined('FILTROCLIENTES_API_BASE_URL') ? (string) FILTROCLIENTES_API_BASE_URL : (string) ($saved['base_url'] ?? '');
        $clientId = defined('FILTROCLIENTES_API_CLIENT_ID') ? (string) FILTROCLIENTES_API_CLIENT_ID : (string) ($saved['client_id'] ?? '');
        $clientSecret = defined('FILTROCLIENTES_API_CLIENT_SECRET') ? (string) FILTROCLIENTES_API_CLIENT_SECRET : (string) ($saved['client_secret'] ?? '');
        $defaultLimit = (int) ($saved['default_limit'] ?? 50);
        $portalEmail = defined('FILTROCLIENTES_PORTAL_EMAIL') ? (string) FILTROCLIENTES_PORTAL_EMAIL : (string) ($saved['portal_email'] ?? '');
        $portalPassword = defined('FILTROCLIENTES_PORTAL_PASSWORD') ? (string) FILTROCLIENTES_PORTAL_PASSWORD : (string) ($saved['portal_password'] ?? '');

        return [
            'base_url' => rtrim($baseUrl, '/'),
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'default_limit' => max(1, min(200, $defaultLimit)),
            'portal_email' => $portalEmail,
            'portal_password' => $portalPassword
        ];
    }
}
