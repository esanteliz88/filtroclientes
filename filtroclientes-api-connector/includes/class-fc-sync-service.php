<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Sync_Service
{
    public static function handle_sync_request(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('No autorizado');
        }

        check_admin_referer('fc_sync_submissions');

        $settings = FC_Settings::get();
        $limit = $settings['default_limit'];
        $result = self::sync_once($limit, 0, false);

        $redirect = add_query_arg([
            'page' => 'fc-dashboard',
            'fc_sync' => is_wp_error($result) ? 'error' : 'ok',
            'fc_message' => is_wp_error($result) ? rawurlencode($result->get_error_message()) : rawurlencode('Sincronizacion completada')
        ], admin_url('admin.php'));

        wp_safe_redirect($redirect);
        exit;
    }

    public static function sync_once(int $limit = 100, int $skip = 0, bool $onlyWithMatch = false)
    {
        $data = FC_Api_Client::fetch_submissions($limit, $skip, $onlyWithMatch);
        if (is_wp_error($data)) {
            return $data;
        }

        $items = isset($data['submissions']) && is_array($data['submissions']) ? $data['submissions'] : [];
        foreach ($items as $item) {
            self::upsert_submission($item);
        }

        return true;
    }

    private static function upsert_submission(array $item): void
    {
        $externalId = isset($item['_id']) ? (string) $item['_id'] : '';
        if ($externalId === '') {
            return;
        }

        $normalized = isset($item['normalized']) && is_array($item['normalized']) ? $item['normalized'] : [];
        $match = isset($item['match']) && is_array($item['match']) ? $item['match'] : [];
        $contact = isset($normalized['contacto_nombre']) ? (string) $normalized['contacto_nombre'] : 'Sin nombre';
        $entryDate = isset($normalized['entry_date']) ? (string) $normalized['entry_date'] : '';
        $title = sprintf('%s - %s', $contact, $entryDate !== '' ? $entryDate : current_time('mysql'));

        $existing = get_posts([
            'post_type' => FC_CPT::POST_TYPE,
            'post_status' => 'publish',
            'meta_key' => '_fc_external_id',
            'meta_value' => $externalId,
            'fields' => 'ids',
            'numberposts' => 1
        ]);

        $postData = [
            'post_type' => FC_CPT::POST_TYPE,
            'post_status' => 'publish',
            'post_title' => $title
        ];

        if (!empty($existing)) {
            $postData['ID'] = (int) $existing[0];
            $postId = wp_update_post($postData, true);
        } else {
            $postId = wp_insert_post($postData, true);
        }

        if (is_wp_error($postId) || !$postId) {
            return;
        }

        update_post_meta($postId, '_fc_external_id', $externalId);
        update_post_meta($postId, '_fc_contact_name', isset($normalized['contacto_nombre']) ? (string) $normalized['contacto_nombre'] : '');
        update_post_meta($postId, '_fc_contact_email', isset($normalized['contacto_email']) ? (string) $normalized['contacto_email'] : '');
        update_post_meta($postId, '_fc_entry_date', isset($normalized['entry_date']) ? (string) $normalized['entry_date'] : '');
        update_post_meta($postId, '_fc_centros', isset($normalized['centro']) ? wp_json_encode($normalized['centro']) : '[]');
        update_post_meta($postId, '_fc_ecog', isset($match['ecog_score']) ? (string) $match['ecog_score'] : '');
        update_post_meta($postId, '_fc_match_total', isset($match['total_matches']) ? (int) $match['total_matches'] : 0);
        update_post_meta($postId, '_fc_match_payload', wp_json_encode($match));
        update_post_meta($postId, '_fc_normalized_payload', wp_json_encode($normalized));
        update_post_meta($postId, '_fc_raw_payload', isset($item['rawPayload']) ? wp_json_encode($item['rawPayload']) : '{}');
    }
}
