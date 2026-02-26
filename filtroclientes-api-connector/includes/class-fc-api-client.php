<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Api_Client
{
    public static function get_access_token(bool $forceRefresh = false)
    {
        if (!$forceRefresh) {
            $cached = get_transient(FC_Settings::TOKEN_TRANSIENT);
            if (is_string($cached) && $cached !== '') {
                return $cached;
            }
        }

        $settings = FC_Settings::get();
        if ($settings['base_url'] === '' || $settings['client_id'] === '' || $settings['client_secret'] === '') {
            return new WP_Error('fc_missing_config', 'Falta configurar base_url, client_id o client_secret.');
        }

        $response = wp_remote_post($settings['base_url'] . '/oauth/token', [
            'timeout' => 20,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'grant_type' => 'client_credentials',
                'client_id' => $settings['client_id'],
                'client_secret' => $settings['client_secret'],
                'scope' => 'read'
            ])
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($code !== 200 || !is_array($body) || empty($body['access_token'])) {
            return new WP_Error('fc_token_error', 'No se pudo obtener token.', ['status' => $code, 'body' => $body]);
        }

        $token = (string) $body['access_token'];
        $ttl = isset($body['expires_in']) ? max(60, ((int) $body['expires_in']) - 60) : 3000;
        set_transient(FC_Settings::TOKEN_TRANSIENT, $token, $ttl);

        return $token;
    }

    public static function fetch_submissions(int $limit = 50, int $skip = 0, bool $onlyWithMatch = false)
    {
        $settings = FC_Settings::get();
        if ($settings['base_url'] === '') {
            return new WP_Error('fc_missing_config', 'Base URL no configurada.');
        }

        $token = self::get_access_token();
        if (is_wp_error($token)) {
            return $token;
        }

        $url = add_query_arg([
            'limit' => max(1, min(200, $limit)),
            'skip' => max(0, $skip),
            'onlyWithMatch' => $onlyWithMatch ? 'true' : 'false'
        ], $settings['base_url'] . '/api/submissions');

        $request = static function (string $jwt) use ($url) {
            return wp_remote_get($url, [
                'timeout' => 25,
                'headers' => [
                    'Authorization' => 'Bearer ' . $jwt
                ]
            ]);
        };

        $response = $request($token);
        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code === 401) {
            $fresh = self::get_access_token(true);
            if (is_wp_error($fresh)) {
                return $fresh;
            }
            $response = $request($fresh);
            if (is_wp_error($response)) {
                return $response;
            }
            $code = (int) wp_remote_retrieve_response_code($response);
        }

        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($code !== 200 || !is_array($body)) {
            return new WP_Error('fc_api_error', 'Error consultando /api/submissions.', ['status' => $code, 'body' => $body]);
        }

        return $body;
    }
}
