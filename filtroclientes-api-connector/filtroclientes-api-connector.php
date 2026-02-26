<?php
/**
 * Plugin Name: FiltroClientes API Connector
 * Description: Conecta WordPress con FiltroClientes API para listar formularios y matches desde /api/submissions.
 * Version: 1.0.0
 * Author: FiltroClientes
 */

if (!defined('ABSPATH')) {
    exit;
}

final class FiltroClientesApiConnector
{
    private const OPTION_KEY = 'filtroclientes_api_settings';
    private const TOKEN_TRANSIENT_KEY = 'filtroclientes_api_access_token';

    public function __construct()
    {
        add_action('admin_menu', [$this, 'register_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_shortcode('filtroclientes_submissions', [$this, 'render_submissions_shortcode']);
    }

    public function register_menu(): void
    {
        add_options_page(
            'FiltroClientes API',
            'FiltroClientes API',
            'manage_options',
            'filtroclientes-api',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings(): void
    {
        register_setting(
            'filtroclientes_api_group',
            self::OPTION_KEY,
            [$this, 'sanitize_settings']
        );
    }

    public function sanitize_settings(array $input): array
    {
        return [
            'base_url' => isset($input['base_url']) ? esc_url_raw(trim((string) $input['base_url'])) : '',
            'client_id' => isset($input['client_id']) ? sanitize_text_field((string) $input['client_id']) : '',
            'client_secret' => isset($input['client_secret']) ? sanitize_text_field((string) $input['client_secret']) : ''
        ];
    }

    public function render_settings_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = $this->get_settings();
        ?>
        <div class="wrap">
            <h1>FiltroClientes API</h1>
            <p>Configura credenciales del client con permisos de lectura sobre <code>/api/submissions</code>.</p>
            <form method="post" action="options.php">
                <?php settings_fields('filtroclientes_api_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="fc_base_url">Base URL</label></th>
                        <td><input id="fc_base_url" name="<?php echo esc_attr(self::OPTION_KEY); ?>[base_url]" type="url" class="regular-text" value="<?php echo esc_attr($settings['base_url']); ?>" placeholder="https://apiclientes.guiaysalud.com"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="fc_client_id">Client ID</label></th>
                        <td><input id="fc_client_id" name="<?php echo esc_attr(self::OPTION_KEY); ?>[client_id]" type="text" class="regular-text" value="<?php echo esc_attr($settings['client_id']); ?>"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="fc_client_secret">Client Secret</label></th>
                        <td><input id="fc_client_secret" name="<?php echo esc_attr(self::OPTION_KEY); ?>[client_secret]" type="password" class="regular-text" value="<?php echo esc_attr($settings['client_secret']); ?>" autocomplete="new-password"></td>
                    </tr>
                </table>
                <?php submit_button('Guardar configuración'); ?>
            </form>
            <hr>
            <h2>Shortcode</h2>
            <p>Usa <code>[filtroclientes_submissions limit="20" only_with_match="false"]</code> en una página.</p>
        </div>
        <?php
    }

    private function get_settings(): array
    {
        $saved = get_option(self::OPTION_KEY, []);

        $baseUrl = defined('FILTROCLIENTES_API_BASE_URL') ? (string) FILTROCLIENTES_API_BASE_URL : (($saved['base_url'] ?? '') ?: '');
        $clientId = defined('FILTROCLIENTES_API_CLIENT_ID') ? (string) FILTROCLIENTES_API_CLIENT_ID : (($saved['client_id'] ?? '') ?: '');
        $clientSecret = defined('FILTROCLIENTES_API_CLIENT_SECRET') ? (string) FILTROCLIENTES_API_CLIENT_SECRET : (($saved['client_secret'] ?? '') ?: '');

        return [
            'base_url' => rtrim($baseUrl, '/'),
            'client_id' => $clientId,
            'client_secret' => $clientSecret
        ];
    }

    private function get_access_token(bool $forceRefresh = false)
    {
        if (!$forceRefresh) {
            $cached = get_transient(self::TOKEN_TRANSIENT_KEY);
            if (is_string($cached) && $cached !== '') {
                return $cached;
            }
        }

        $settings = $this->get_settings();
        if ($settings['base_url'] === '' || $settings['client_id'] === '' || $settings['client_secret'] === '') {
            return new WP_Error('fc_missing_config', 'Falta configurar base_url, client_id o client_secret.');
        }

        $response = wp_remote_post($settings['base_url'] . '/oauth/token', [
            'timeout' => 20,
            'headers' => [
                'Content-Type' => 'application/json'
            ],
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
            return new WP_Error('fc_token_error', 'No se pudo obtener token desde API.', [
                'status' => $code,
                'body' => $body
            ]);
        }

        $token = (string) $body['access_token'];
        $expiresIn = isset($body['expires_in']) ? max(60, (int) $body['expires_in'] - 60) : 3000;
        set_transient(self::TOKEN_TRANSIENT_KEY, $token, $expiresIn);

        return $token;
    }

    private function fetch_submissions(array $query = [])
    {
        $settings = $this->get_settings();
        $token = $this->get_access_token();
        if (is_wp_error($token)) {
            return $token;
        }

        $url = add_query_arg($query, $settings['base_url'] . '/api/submissions');

        $request = function (string $jwt) use ($url) {
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
            $fresh = $this->get_access_token(true);
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
            return new WP_Error('fc_submissions_error', 'No se pudo listar submissions.', [
                'status' => $code,
                'body' => $body
            ]);
        }

        return $body;
    }

    public function render_submissions_shortcode(array $atts): string
    {
        $atts = shortcode_atts([
            'limit' => '20',
            'skip' => '0',
            'only_with_match' => 'false',
            'source_user_id' => ''
        ], $atts, 'filtroclientes_submissions');

        $query = [
            'limit' => max(1, min(200, (int) $atts['limit'])),
            'skip' => max(0, (int) $atts['skip']),
            'onlyWithMatch' => in_array(strtolower((string) $atts['only_with_match']), ['1', 'true', 'yes'], true) ? 'true' : 'false'
        ];

        if ($atts['source_user_id'] !== '') {
            $query['sourceUserId'] = (int) $atts['source_user_id'];
        }

        $data = $this->fetch_submissions($query);
        if (is_wp_error($data)) {
            return '<div class="filtroclientes-error"><strong>Error:</strong> ' . esc_html($data->get_error_message()) . '</div>';
        }

        $submissions = isset($data['submissions']) && is_array($data['submissions']) ? $data['submissions'] : [];
        $total = isset($data['total']) ? (int) $data['total'] : 0;

        ob_start();
        ?>
        <div class="filtroclientes-submissions">
            <p><strong>Total:</strong> <?php echo esc_html((string) $total); ?></p>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Fecha</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Contacto</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Email</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Centro</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">ECOG</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px;">Matches</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($submissions)) : ?>
                        <tr>
                            <td colspan="6" style="padding:10px;">Sin resultados.</td>
                        </tr>
                    <?php else : ?>
                        <?php foreach ($submissions as $row) :
                            $normalized = isset($row['normalized']) && is_array($row['normalized']) ? $row['normalized'] : [];
                            $match = isset($row['match']) && is_array($row['match']) ? $row['match'] : [];
                            $centros = isset($normalized['centro']) && is_array($normalized['centro']) ? implode(', ', $normalized['centro']) : '';
                            $contacto = isset($normalized['contacto_nombre']) ? (string) $normalized['contacto_nombre'] : '';
                            $email = isset($normalized['contacto_email']) ? (string) $normalized['contacto_email'] : '';
                            $entryDate = isset($normalized['entry_date']) ? (string) $normalized['entry_date'] : '';
                            $ecog = isset($match['ecog_score']) ? (string) $match['ecog_score'] : '-';
                            $matches = isset($match['total_matches']) ? (int) $match['total_matches'] : 0;
                            ?>
                            <tr>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html($entryDate); ?></td>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html($contacto); ?></td>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html($email); ?></td>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html($centros); ?></td>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html($ecog); ?></td>
                                <td style="border-bottom:1px solid #f0f0f0;padding:8px;"><?php echo esc_html((string) $matches); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
        return (string) ob_get_clean();
    }
}

new FiltroClientesApiConnector();
