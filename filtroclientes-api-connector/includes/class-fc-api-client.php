<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Api_Client
{
    public static function get_access_token(bool $forceRefresh = false, string $scope = 'read')
    {
        $scope = $scope === 'write' ? 'write' : 'read';
        $settings = FC_Settings::get();
        $transientKey = self::token_transient_key($scope, $settings);
        $legacyTransientKey = FC_Settings::TOKEN_TRANSIENT . '_' . $scope;

        if (!$forceRefresh) {
            $cached = get_transient($transientKey);
            if (is_string($cached) && $cached !== '') {
                return $cached;
            }

            // Cleanup stale legacy cache key if present.
            delete_transient($legacyTransientKey);
        }

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
        $query = [
            'limit' => max(1, min(200, $limit)),
            'skip' => max(0, $skip)
        ];
        if ($onlyWithMatch) {
            $query['onlyWithMatch'] = 'true';
        }

        return self::request_json('/api/submissions', $query);
    }

    public static function fetch_metrics(int $days = 30)
    {
        return self::request_json('/api/metrics', [
            'days' => max(1, min(365, $days))
        ]);
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
                $currentId = '';
                if (isset($item['_id'])) {
                    if (is_string($item['_id'])) {
                        $currentId = $item['_id'];
                    } elseif (is_array($item['_id']) && isset($item['_id']['$oid']) && is_string($item['_id']['$oid'])) {
                        $currentId = $item['_id']['$oid'];
                    }
                }
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

    public static function can_manage_studies()
    {
        $role = self::get_portal_role(false);
        if (is_wp_error($role)) {
            return false;
        }
        return $role === 'super_admin';
    }

    public static function fetch_studies(int $limit = 50, int $skip = 0, string $search = '')
    {
        $query = [
            'limit' => max(1, min(200, $limit)),
            'skip' => max(0, $skip)
        ];
        if (trim($search) !== '') {
            $query['search'] = $search;
        }

        return self::request_portal_json('/portal/studies', $query);
    }

    public static function fetch_study_by_id(string $studyId)
    {
        return self::request_portal_json('/portal/studies/' . rawurlencode($studyId));
    }

    public static function create_study(array $payload)
    {
        return self::request_portal_json('/portal/studies', [], 'POST', $payload);
    }

    public static function update_study(string $studyId, array $payload)
    {
        return self::request_portal_json('/portal/studies/' . rawurlencode($studyId), [], 'PATCH', $payload);
    }

    public static function delete_study(string $studyId)
    {
        return self::request_portal_json('/portal/studies/' . rawurlencode($studyId), [], 'DELETE');
    }

    private static function get_portal_role(bool $forceRefresh = false)
    {
        $settings = FC_Settings::get();
        $roleKey = self::portal_role_transient_key($settings);
        if (!$forceRefresh) {
            $cached = get_transient($roleKey);
            if (is_string($cached) && $cached !== '') {
                return $cached;
            }
        }

        $token = self::get_portal_token($forceRefresh);
        if (is_wp_error($token)) {
            return $token;
        }

        $role = self::peek_portal_role($token);
        if ($role) {
            set_transient($roleKey, $role, 300);
        }

        return $role ? $role : new WP_Error('fc_portal_role', 'No se pudo determinar el rol portal.');
    }

    private static function get_portal_token(bool $forceRefresh = false)
    {
        $settings = FC_Settings::get();
        $tokenKey = self::portal_token_transient_key($settings);

        if (!$forceRefresh) {
            $cached = get_transient($tokenKey);
            if (is_string($cached) && $cached !== '') {
                return $cached;
            }
        }

        if ($settings['base_url'] === '' || $settings['portal_email'] === '' || $settings['portal_password'] === '') {
            return new WP_Error('fc_missing_portal_config', 'Falta configurar credenciales portal.');
        }

        $response = wp_remote_post($settings['base_url'] . '/oauth/user-token', [
            'timeout' => 20,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'grant_type' => 'password',
                'email' => $settings['portal_email'],
                'password' => $settings['portal_password']
            ])
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($code !== 200 || !is_array($body) || empty($body['access_token'])) {
            return new WP_Error('fc_portal_token_error', 'No se pudo obtener token portal.', ['status' => $code, 'body' => $body]);
        }

        $token = (string) $body['access_token'];
        $ttl = isset($body['expires_in']) ? max(60, ((int) $body['expires_in']) - 60) : 3000;
        set_transient($tokenKey, $token, $ttl);
        if (!empty($body['role'])) {
            set_transient(self::portal_role_transient_key($settings), (string) $body['role'], min(300, $ttl));
        }

        return $token;
    }

    private static function request_portal_json(string $path, array $query = [], string $method = 'GET', array $body = [])
    {
        $settings = FC_Settings::get();
        if ($settings['base_url'] === '') {
            return new WP_Error('fc_missing_config', 'Base URL no configurada.');
        }

        $token = self::get_portal_token(false);
        if (is_wp_error($token)) {
            return $token;
        }

        $baseUrl = rtrim($settings['base_url'], '/');
        $url = $baseUrl . $path;
        if (!empty($query)) {
            $url = add_query_arg($query, $url);
        }

        $request = static function (string $jwt) use ($url, $method, $body) {
            $args = [
                'method' => strtoupper($method),
                'timeout' => 25,
                'headers' => [
                    'Authorization' => 'Bearer ' . $jwt,
                    'Content-Type' => 'application/json'
                ]
            ];
            if (!empty($body)) {
                $args['body'] = wp_json_encode($body);
            }
            return wp_remote_request($url, $args);
        };

        $response = $request($token);
        if (is_wp_error($response)) {
            return $response;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code === 401) {
            $fresh = self::get_portal_token(true);
            if (is_wp_error($fresh)) {
                return $fresh;
            }
            $response = $request($fresh);
            if (is_wp_error($response)) {
                return $response;
            }
            $code = (int) wp_remote_retrieve_response_code($response);
        }

        if ($code === 204) {
            return [];
        }

        $rawBody = (string) wp_remote_retrieve_body($response);
        $decoded = $rawBody !== '' ? json_decode($rawBody, true) : [];
        if ($code !== 200 && $code !== 201) {
            return new WP_Error('fc_portal_api_error', 'Error consultando portal.', ['status' => $code, 'body' => $decoded, 'path' => $path]);
        }
        if (!is_array($decoded)) {
            return new WP_Error('fc_portal_api_error', 'Respuesta portal invalida.', ['status' => $code, 'body' => $rawBody, 'path' => $path]);
        }

        return $decoded;
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

    private static function token_transient_key(string $scope, array $settings): string
    {
        $fingerprint = md5((string) ($settings['base_url'] ?? '') . '|' . (string) ($settings['client_id'] ?? ''));
        return FC_Settings::TOKEN_TRANSIENT . '_' . $scope . '_' . substr($fingerprint, 0, 12);
    }

    private static function portal_token_transient_key(array $settings): string
    {
        $fingerprint = md5((string) ($settings['base_url'] ?? '') . '|' . (string) ($settings['portal_email'] ?? ''));
        return FC_Settings::PORTAL_TOKEN_TRANSIENT . '_' . substr($fingerprint, 0, 12);
    }

    private static function portal_role_transient_key(array $settings): string
    {
        $fingerprint = md5((string) ($settings['base_url'] ?? '') . '|' . (string) ($settings['portal_email'] ?? ''));
        return FC_Settings::PORTAL_ROLE_TRANSIENT . '_' . substr($fingerprint, 0, 12);
    }

    private static function peek_portal_role(string $jwt): ?string
    {
        $parts = explode('.', $jwt);
        if (count($parts) < 2) return null;
        $payload = $parts[1];
        $payload .= str_repeat('=', (4 - (strlen($payload) % 4)) % 4);
        $decoded = base64_decode(strtr($payload, '-_', '+/'));
        if (!is_string($decoded) || $decoded === '') return null;
        $data = json_decode($decoded, true);
        if (!is_array($data)) return null;
        return isset($data['role']) && is_string($data['role']) ? $data['role'] : null;
    }
}
