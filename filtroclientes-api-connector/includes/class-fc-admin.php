<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Admin
{
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
        add_submenu_page('fc-dashboard', 'Registros', 'Registros', 'manage_options', 'edit.php?post_type=' . FC_CPT::POST_TYPE);
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

        $total = (int) wp_count_posts(FC_CPT::POST_TYPE)->publish;
        $withMatch = (int) self::count_by_match(true);
        $withoutMatch = (int) self::count_by_match(false);
        ?>
        <div class="wrap fc-wrap">
            <h1>FiltroClientes Dashboard</h1>
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
                    <?php submit_button('Guardar configuración'); ?>
                </form>
            </div>
        </div>
        <?php
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
}
