<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Admin
{
    private const AUTO_SYNC_TRANSIENT = 'fc_auto_sync_last_run';
    private const AUTO_SYNC_INTERVAL = 30;

    public static function register_menu(): void
    {
        add_menu_page(
            'FiltroClientes',
            'FiltroClientes',
            'manage_options',
            'fc-dashboard',
            [self::class, 'render_dashboard_page'],
            'dashicons-chart-area',
            30
        );

        add_submenu_page('fc-dashboard', 'Dashboard', 'Dashboard', 'manage_options', 'fc-dashboard', [self::class, 'render_dashboard_page']);
        add_submenu_page('fc-dashboard', 'Conexion API', 'Conexion API', 'manage_options', 'fc-settings', [self::class, 'render_settings_page']);
        add_submenu_page(null, 'Ficha clinica', 'Ficha clinica', 'manage_options', 'fc-record', [self::class, 'render_record_page']);
    }

    public static function enqueue_assets(string $hook): void
    {
        if (strpos($hook, 'fc-') === false) {
            return;
        }

        wp_enqueue_style(
            'fc-admin-style',
            FC_PLUGIN_URL . 'assets/css/admin.css',
            [],
            FC_PLUGIN_VERSION
        );
    }

    public static function render_dashboard_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $autoSyncError = self::run_auto_sync_if_needed();

        $total = (int) wp_count_posts(FC_CPT::POST_TYPE)->publish;
        $withMatch = (int) self::count_by_match(true);
        $withoutMatch = (int) self::count_by_match(false);
        $recentTable = FC_Shortcodes::render_submissions_table(['limit' => '10']);
        ?>
        <div class="wrap fc-wrap">
            <h1>FiltroClientes Dashboard</h1>
            <?php if (is_wp_error($autoSyncError)) : ?>
                <div class="notice notice-error"><p><?php echo esc_html('Auto-sync fallo: ' . $autoSyncError->get_error_message()); ?></p></div>
            <?php endif; ?>
            <?php self::render_notice(); ?>
            <div class="fc-cards">
                <div class="fc-card">
                    <span class="fc-label">Registros Totales</span>
                    <strong class="fc-value"><?php echo esc_html((string) $total); ?></strong>
                </div>
                <div class="fc-card">
                    <span class="fc-label">Con Match</span>
                    <strong class="fc-value"><?php echo esc_html((string) $withMatch); ?></strong>
                </div>
                <div class="fc-card">
                    <span class="fc-label">Sin Match</span>
                    <strong class="fc-value"><?php echo esc_html((string) $withoutMatch); ?></strong>
                </div>
            </div>
            <div class="fc-panel">
                <h2>Sincronizacion</h2>
                <p>Trae formularios desde API y los guarda/actualiza en el CPT local.</p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="fc_sync_submissions">
                    <?php wp_nonce_field('fc_sync_submissions'); ?>
                    <?php submit_button('Sincronizar ahora', 'primary', 'submit', false); ?>
                </form>
            </div>
            <div class="fc-panel">
                <h2>Registros recientes</h2>
                <?php echo wp_kses_post($recentTable); ?>
            </div>
        </div>
        <?php
    }

    public static function render_settings_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = FC_Settings::get();
        ?>
        <div class="wrap fc-wrap">
            <h1>Conexion API</h1>
            <div class="fc-panel">
                <form method="post" action="options.php">
                    <?php settings_fields('fc_api_group'); ?>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row"><label for="fc_base_url">Base URL</label></th>
                            <td><input id="fc_base_url" name="<?php echo esc_attr(FC_Settings::OPTION_KEY); ?>[base_url]" type="url" class="regular-text" value="<?php echo esc_attr($settings['base_url']); ?>" placeholder="https://apiclientes.guiaysalud.com"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="fc_client_id">Client ID</label></th>
                            <td><input id="fc_client_id" name="<?php echo esc_attr(FC_Settings::OPTION_KEY); ?>[client_id]" type="text" class="regular-text" value="<?php echo esc_attr($settings['client_id']); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="fc_client_secret">Client Secret</label></th>
                            <td><input id="fc_client_secret" name="<?php echo esc_attr(FC_Settings::OPTION_KEY); ?>[client_secret]" type="password" class="regular-text" value="<?php echo esc_attr($settings['client_secret']); ?>" autocomplete="new-password"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="fc_default_limit">Limite sync</label></th>
                            <td><input id="fc_default_limit" name="<?php echo esc_attr(FC_Settings::OPTION_KEY); ?>[default_limit]" type="number" min="1" max="200" class="small-text" value="<?php echo esc_attr((string) $settings['default_limit']); ?>"></td>
                        </tr>
                    </table>
                    <?php submit_button('Guardar configuracion'); ?>
                </form>
            </div>
        </div>
        <?php
    }

    public static function render_record_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $recordId = isset($_GET['record_id']) ? (int) $_GET['record_id'] : 0;
        if ($recordId <= 0) {
            echo '<div class="wrap"><h1>Ficha clinica</h1><div class="notice notice-error"><p>Registro no valido.</p></div></div>';
            return;
        }

        $post = get_post($recordId);
        if (!$post || $post->post_type !== FC_CPT::POST_TYPE) {
            echo '<div class="wrap"><h1>Ficha clinica</h1><div class="notice notice-error"><p>Registro no encontrado.</p></div></div>';
            return;
        }

        $normalized = self::normalize_for_display(self::decode_meta_json($recordId, '_fc_normalized_payload'));
        $rawPayload = self::normalize_for_display(self::decode_meta_json($recordId, '_fc_raw_payload'));
        $matchPayload = self::normalize_for_display(self::decode_meta_json($recordId, '_fc_match_payload'));
        $companyCodes = self::normalize_for_display(self::decode_meta_json($recordId, '_fc_company_codes'));
        $source = self::normalize_string((string) get_post_meta($recordId, '_fc_source', true));
        $createdAt = self::normalize_string((string) get_post_meta($recordId, '_fc_created_at', true));
        $externalId = self::normalize_string((string) get_post_meta($recordId, '_fc_external_id', true));
        $backUrl = admin_url('admin.php?page=fc-dashboard');
        ?>
        <div class="wrap fc-wrap fc-record">
            <h1>Ficha clinica del paciente</h1>
            <p><a class="button" href="<?php echo esc_url($backUrl); ?>">Volver al dashboard</a></p>

            <div class="fc-record-grid">
                <div class="fc-record-card">
                    <h2>Resumen</h2>
                    <ul>
                        <li><strong>Fecha registro:</strong> <?php echo esc_html((string) ($normalized['entry_date'] ?? $createdAt)); ?></li>
                        <li><strong>Paciente:</strong> <?php echo esc_html((string) ($normalized['contacto_nombre'] ?? '')); ?></li>
                        <li><strong>Email:</strong> <?php echo esc_html((string) ($normalized['contacto_email'] ?? '')); ?></li>
                        <li><strong>Telefono:</strong> <?php echo esc_html((string) ($normalized['contacto_telefono'] ?? '')); ?></li>
                        <li><strong>Centro(s):</strong> <?php echo esc_html(self::value_to_string($normalized['centro'] ?? [])); ?></li>
                    </ul>
                </div>

                <div class="fc-record-card">
                    <h2>Datos clinicos</h2>
                    <ul>
                        <li><strong>Enfermedad:</strong> <?php echo esc_html((string) ($normalized['enfermedad'] ?? '')); ?></li>
                        <li><strong>Tipo:</strong> <?php echo esc_html((string) ($normalized['tipo_enfermedad'] ?? '')); ?></li>
                        <li><strong>Subtipo:</strong> <?php echo esc_html((string) ($normalized['subtipo_enfermedad'] ?? '')); ?></li>
                        <li><strong>Metastasis:</strong> <?php echo esc_html((string) ($normalized['metastasis'] ?? '')); ?></li>
                        <li><strong>ECOG:</strong> <?php echo esc_html((string) ($matchPayload['ecog_score'] ?? '')); ?></li>
                        <li><strong>Matches:</strong> <?php echo esc_html((string) ($matchPayload['total_matches'] ?? 0)); ?></li>
                    </ul>
                </div>
            </div>

            <div class="fc-record-card">
                <h2>Tratamiento y cirugia</h2>
                <ul>
                    <li><strong>Cirugia:</strong> <?php echo esc_html((string) ($normalized['cirugia'] ?? '')); ?></li>
                    <li><strong>Fecha cirugia:</strong> <?php echo esc_html((string) ($normalized['cirugia_fecha'] ?? '')); ?></li>
                    <li><strong>Descripcion cirugia:</strong> <?php echo esc_html((string) ($normalized['cirugia_descripcion'] ?? '')); ?></li>
                    <li><strong>Tratamiento:</strong> <?php echo esc_html((string) ($normalized['tratamiento'] ?? '')); ?></li>
                    <li><strong>Tipo de tratamiento:</strong> <?php echo esc_html(self::value_to_string($normalized['tratamiento_tipo'] ?? [])); ?></li>
                </ul>
            </div>

            <div class="fc-record-card">
                <h2>Contexto y trazabilidad</h2>
                <ul>
                    <li><strong>External ID:</strong> <?php echo esc_html($externalId); ?></li>
                    <li><strong>Source:</strong> <?php echo esc_html($source); ?></li>
                    <li><strong>Company Codes:</strong> <?php echo esc_html(self::value_to_string($companyCodes)); ?></li>
                    <li><strong>Creado API:</strong> <?php echo esc_html($createdAt); ?></li>
                    <li><strong>User ref:</strong> <?php echo esc_html((string) ($normalized['user_ref'] ?? '')); ?></li>
                </ul>
            </div>

            <div class="fc-record-card">
                <h2>JSON completo</h2>
                <h3>Normalized</h3>
                <pre><?php echo esc_html(wp_json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); ?></pre>
                <h3>Match</h3>
                <pre><?php echo esc_html(wp_json_encode($matchPayload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); ?></pre>
                <h3>Raw payload</h3>
                <pre><?php echo esc_html(wp_json_encode($rawPayload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); ?></pre>
            </div>
        </div>
        <?php
    }

    private static function run_auto_sync_if_needed()
    {
        $lastRun = (int) get_transient(self::AUTO_SYNC_TRANSIENT);
        $now = time();
        if ($lastRun > 0 && ($now - $lastRun) < self::AUTO_SYNC_INTERVAL) {
            return true;
        }

        $settings = FC_Settings::get();
        if ($settings['base_url'] === '' || $settings['client_id'] === '' || $settings['client_secret'] === '') {
            return new WP_Error('fc_missing_config', 'Configura Base URL, Client ID y Client Secret.');
        }

        $result = FC_Sync_Service::sync_all($settings['default_limit'], false, 20);
        if (is_wp_error($result)) {
            return $result;
        }

        set_transient(self::AUTO_SYNC_TRANSIENT, $now, self::AUTO_SYNC_INTERVAL);
        return true;
    }

    private static function count_by_match(bool $withMatch): int
    {
        $metaQuery = $withMatch
            ? [
                [
                    'key' => '_fc_match_total',
                    'value' => 0,
                    'compare' => '>',
                    'type' => 'NUMERIC'
                ]
            ]
            : [
                'relation' => 'OR',
                [
                    'key' => '_fc_match_total',
                    'compare' => 'NOT EXISTS'
                ],
                [
                    'key' => '_fc_match_total',
                    'value' => 0,
                    'compare' => '=',
                    'type' => 'NUMERIC'
                ]
            ];

        $query = new WP_Query([
            'post_type' => FC_CPT::POST_TYPE,
            'post_status' => 'publish',
            'posts_per_page' => 1,
            'meta_query' => $metaQuery,
            'fields' => 'ids'
        ]);

        return (int) $query->found_posts;
    }

    private static function render_notice(): void
    {
        if (!isset($_GET['fc_sync'])) {
            return;
        }

        $isError = $_GET['fc_sync'] === 'error';
        $message = isset($_GET['fc_message']) ? sanitize_text_field(wp_unslash((string) $_GET['fc_message'])) : ($isError ? 'Error de sincronizacion' : 'Sincronizacion ok');
        $class = $isError ? 'notice notice-error' : 'notice notice-success';

        printf('<div class="%s"><p>%s</p></div>', esc_attr($class), esc_html($message));
    }

    private static function decode_meta_json(int $postId, string $metaKey): array
    {
        $raw = get_post_meta($postId, $metaKey, true);
        if (!is_string($raw) || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    private static function normalize_for_display($value)
    {
        if (is_array($value)) {
            $normalized = [];
            foreach ($value as $k => $v) {
                $normalized[$k] = self::normalize_for_display($v);
            }
            return $normalized;
        }

        if (is_string($value)) {
            return self::normalize_string($value);
        }

        return $value;
    }

    private static function normalize_string(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $value);
        $decoded = json_decode('"' . $escaped . '"', true);
        if (is_string($decoded) && $decoded !== '') {
            $value = $decoded;
        }

        $value = (string) preg_replace_callback('/u([0-9a-fA-F]{4})/', static function ($m) {
            return html_entity_decode('&#x' . strtolower((string) $m[1]) . ';', ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }, $value);

        if (preg_match('/Ãƒ.|Ã‚|u00[0-9a-fA-F]{2}/', $value) === 1) {
            $latin1ToUtf8 = @mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
            if (is_string($latin1ToUtf8) && $latin1ToUtf8 !== '') {
                $value = $latin1ToUtf8;
            }
        }

        return trim((string) preg_replace('/\s+/', ' ', $value));
    }

    private static function value_to_string($value): string
    {
        if (is_array($value)) {
            $isList = array_keys($value) === range(0, count($value) - 1);
            return $isList
                ? implode(', ', array_map([self::class, 'value_to_string'], $value))
                : wp_json_encode($value, JSON_UNESCAPED_UNICODE);
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if ($value === null) {
            return '';
        }

        return self::normalize_string((string) $value);
    }
}

