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
            'show_in_menu' => false,
            'supports' => ['title'],
            'capability_type' => 'post',
            'map_meta_cap' => true
        ]);
    }
}
