<?php

if (!defined('ABSPATH')) {
    exit;
}

require_once FC_PLUGIN_DIR . 'includes/class-fc-settings.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-api-client.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-admin.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-shortcodes.php';

final class FC_Plugin
{
    public static function boot(): void
    {
        add_action('admin_menu', [FC_Admin::class, 'register_menu']);
        add_action('admin_init', [FC_Settings::class, 'register_settings']);
        add_action('admin_enqueue_scripts', [FC_Admin::class, 'enqueue_assets']);
        add_action('admin_post_fc_clear_credentials', [FC_Admin::class, 'handle_clear_credentials']);
        add_action('admin_post_fc_study_upsert', [FC_Admin::class, 'handle_study_upsert']);
        add_action('admin_post_fc_study_delete', [FC_Admin::class, 'handle_study_delete']);
        add_shortcode('filtroclientes_registros', [FC_Shortcodes::class, 'render_submissions_table']);
    }
}
