<?php

if (!defined('ABSPATH')) {
    exit;
}

require_once FC_PLUGIN_DIR . 'includes/class-fc-settings.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-api-client.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-cpt.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-sync-service.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-admin.php';
require_once FC_PLUGIN_DIR . 'includes/class-fc-shortcodes.php';

final class FC_Plugin
{
    public static function boot(): void
    {
        add_action('init', [FC_CPT::class, 'register']);
        add_action('admin_menu', [FC_Admin::class, 'register_menu']);
        add_action('admin_init', [FC_Settings::class, 'register_settings']);
        add_action('admin_enqueue_scripts', [FC_Admin::class, 'enqueue_assets']);
        add_action('admin_post_fc_sync_submissions', [FC_Sync_Service::class, 'handle_sync_request']);
        add_shortcode('filtroclientes_registros', [FC_Shortcodes::class, 'render_submissions_table']);
    }
}
