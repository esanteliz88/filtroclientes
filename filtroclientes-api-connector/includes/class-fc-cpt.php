<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_CPT
{
    public const POST_TYPE = 'fc_submission';

    public static function register(): void
    {
        register_post_type(self::POST_TYPE, [
            'labels' => [
                'name' => 'Registros API',
                'singular_name' => 'Registro API'
            ],
            'public' => false,
            'show_ui' => true,
            'show_in_menu' => 'fc-dashboard',
            'supports' => ['title'],
            'capability_type' => 'post',
            'map_meta_cap' => true,
            'capabilities' => [
                'create_posts' => 'do_not_allow'
            ]
        ]);
    }

    public static function block_manual_create_screen(): void
    {
        if (!is_admin()) {
            return;
        }

        $postType = isset($_GET['post_type']) ? sanitize_key((string) $_GET['post_type']) : '';
        $isCreateScreen = isset($GLOBALS['pagenow']) && $GLOBALS['pagenow'] === 'post-new.php';
        if ($isCreateScreen && $postType === self::POST_TYPE) {
            wp_safe_redirect(admin_url('admin.php?page=fc-dashboard'));
            exit;
        }
    }
}
