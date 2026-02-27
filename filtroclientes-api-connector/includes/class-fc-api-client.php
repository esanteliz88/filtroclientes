<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Api_Client
{
    public static function get_access_token(bool $forceRefresh = false, string $scope = 'read')
    {
        $scope = $scope === 'write' ? 'write' : 'read';
        $transientKey = FC_Settings::TOKEN_TRANSIENT . '_' . $scope;

        if (!$forceRefresh) {
            $cached = get_transient($transientKey);
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
                'scope' => $scope
            ])
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($code !== 200 || !is_array($body) || empty($body['access_token'])) {
            return new WP_Error('fc_token_error', 'No se pudo obtener token (' . $scope . ').', ['status' => $code, 'body' => $body]);
        }

        $token = (string) $body['access_token'];
        $ttl = isset($body['expires_in']) ? max(60, ((int) $body['expires_in']) - 60) : 3000;
        set_transient($transientKey, $token, $ttl);

        return $token;
    }

    public static function fetch_submissions(int $limit = 50, int $skip = 0, bool $onlyWithMatch = false)
    {
        return self::request_json('/api/submissions', [
            'limit' => max(1, min(200, $limit)),
            'skip' => max(0, $skip),
            'onlyWithMatch' => $onlyWithMatch ? 'true' : 'false'
        ]);
    }

    public static function fetch_metrics(int $days = 30)
    {
        return self::request_json('/api/metrics', [
            'days' => max(1, min(365, $days))
        ]);
    }

    public static function purge_submissions(?int $olderThanDays = null, bool $onlyWithoutMatch = false)
    {
        $query = [];
        if ($olderThanDays !== null && $olderThanDays > 0) {
            $query['olderThanDays'] = max(1, min(3650, $olderThanDays));
        }
        if ($onlyWithoutMatch) {
            $query['onlyWithoutMatch'] = 'true';
        }

        return self::request_json('/api/submissions', $query, 'DELETE', 'write');
    }

    public static function fetch_submission_by_id(string $externalId, int $maxPages = 20, int $pageLimit = 200)
    {
        $target = trim($externalId);
        if ($target === '') {
            return new WP_Error('fc_missing_id', 'Falta external_id.');
        }

        $safePages = max(1, min(100, $maxPages));
        $safeLimit = max(1, min(200, $pageLimit));
        $skip = 0;

        for ($page = 0; $page < $safePages; $page++) {
            $response = self::fetch_submissions($safeLimit, $skip, false);
            if (is_wp_error($response)) {
                return $response;
            }

            $items = isset($response['submissions']) && is_array($response['submissions'])
                ? $response['submissions']
                : [];

            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $currentId = isset($item['_id']) ? (string) $item['_id'] : '';
                if ($currentId === $target) {
                    return $item;
                }
            }

            if (count($items) < $safeLimit) {
                break;
            }
            $skip += $safeLimit;
        }

        return new WP_Error('fc_not_found', 'No se encontro el registro en API.');
    }

    private static function request_json(string $path, array $query = [], string $method = 'GET', string $scope = 'read')
    {
        $settings = FC_Settings::get();
        if ($settings['base_url'] === '') {
            return new WP_Error('fc_missing_config', 'Base URL no configurada.');
        }

        $token = self::get_access_token(false, $scope);
        if (is_wp_error($token)) {
            return $token;
        }

        $baseUrl = rtrim($settings['base_url'], '/');
        $url = $baseUrl . $path;
        if (!empty($query)) {
            $url = add_query_arg($query, $url);
        }

        $request = static function (string $jwt) use ($url, $method) {
            return wp_remote_request($url, [
                'method' => strtoupper($method),
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
            $fresh = self::get_access_token(true, $scope);
            if (is_wp_error($fresh)) {
                return $fresh;
            }
            $response = $request($fresh);
            if (is_wp_error($response)) {
                return $response;
            }
            $code = (int) wp_remote_retrieve_response_code($response);
        }

        $rawBody = (string) wp_remote_retrieve_body($response);
        $body = $rawBody !== '' ? json_decode($rawBody, true) : [];
        if ($code !== 200 && $code !== 204) {
            return new WP_Error('fc_api_error', 'Error consultando API.', ['status' => $code, 'body' => $body, 'path' => $path]);
        }
        if (!is_array($body)) {
            return new WP_Error('fc_api_error', 'Respuesta API invalida.', ['status' => $code, 'body' => $rawBody, 'path' => $path]);
        }

        return $body;
    }
}
