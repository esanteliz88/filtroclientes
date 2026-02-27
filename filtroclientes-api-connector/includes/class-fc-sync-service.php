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
        $result = self::sync_all($limit, false, 20);

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

    public static function sync_all(int $limit = 100, bool $onlyWithMatch = false, int $maxPages = 10)
    {
        $safeLimit = max(1, min(200, $limit));
        $safePages = max(1, min(50, $maxPages));
        $skip = 0;

        for ($page = 0; $page < $safePages; $page++) {
            $data = FC_Api_Client::fetch_submissions($safeLimit, $skip, $onlyWithMatch);
            if (is_wp_error($data)) {
                return $data;
            }

            $items = isset($data['submissions']) && is_array($data['submissions']) ? $data['submissions'] : [];
            foreach ($items as $item) {
                self::upsert_submission($item);
            }

            if (count($items) < $safeLimit) {
                break;
            }

            $skip += $safeLimit;
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
        update_post_meta($postId, '_fc_source', isset($item['source']) ? (string) $item['source'] : '');
        update_post_meta($postId, '_fc_company_codes', wp_json_encode(self::normalize_code_list($item['companyCodes'] ?? [])));
        update_post_meta($postId, '_fc_created_at', isset($item['createdAt']) ? (string) $item['createdAt'] : '');
        update_post_meta($postId, '_fc_updated_at', isset($item['updatedAt']) ? (string) $item['updatedAt'] : '');
        update_post_meta($postId, '_fc_source_user_id', isset($item['sourceUserId']) ? (string) $item['sourceUserId'] : '');
        update_post_meta($postId, '_fc_source_user_ref', isset($item['sourceUserRef']) ? (string) $item['sourceUserRef'] : '');
        update_post_meta($postId, '_fc_contact_name', isset($normalized['contacto_nombre']) ? (string) $normalized['contacto_nombre'] : '');
        update_post_meta($postId, '_fc_contact_email', isset($normalized['contacto_email']) ? (string) $normalized['contacto_email'] : '');
        update_post_meta($postId, '_fc_entry_date', isset($normalized['entry_date']) ? (string) $normalized['entry_date'] : '');
        update_post_meta($postId, '_fc_centros', wp_json_encode(self::normalize_code_list($normalized['centro'] ?? [])));
        update_post_meta($postId, '_fc_filter_contact', self::normalize_filter_value($normalized['contacto_nombre'] ?? ''));
        update_post_meta($postId, '_fc_filter_email', self::normalize_filter_value($normalized['contacto_email'] ?? ''));
        update_post_meta($postId, '_fc_filter_tipo', self::normalize_filter_value($normalized['tipo_enfermedad'] ?? ''));
        update_post_meta($postId, '_fc_filter_subtipo', self::normalize_filter_value($normalized['subtipo_enfermedad'] ?? ''));
        update_post_meta($postId, '_fc_filter_centro', self::normalize_filter_value(self::normalize_code_list($normalized['centro'] ?? [])));
        update_post_meta($postId, '_fc_filter_ciudad', self::normalize_filter_value($normalized['ciudad'] ?? ''));
        update_post_meta($postId, '_fc_ecog', isset($match['ecog_score']) ? (string) $match['ecog_score'] : '');
        update_post_meta($postId, '_fc_match_total', isset($match['total_matches']) ? (int) $match['total_matches'] : 0);
        update_post_meta($postId, '_fc_match_payload', wp_json_encode($match));
        update_post_meta($postId, '_fc_normalized_payload', wp_json_encode($normalized));
        update_post_meta($postId, '_fc_raw_payload', isset($item['rawPayload']) ? wp_json_encode($item['rawPayload']) : '{}');
        update_post_meta($postId, '_fc_full_item_payload', wp_json_encode($item));
    }

    private static function normalize_code_list($value): array
    {
        $list = is_array($value) ? $value : [$value];
        $out = [];
        foreach ($list as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $code = strtolower(trim((string) $item));
            if ($code !== '') {
                $out[] = $code;
            }
        }
        return array_values(array_unique($out));
    }

    private static function normalize_filter_value($value): string
    {
        $text = is_array($value) ? implode(' ', array_map('strval', $value)) : (string) $value;
        $text = trim($text);
        if ($text === '') {
            return '';
        }

        if (function_exists('remove_accents')) {
            $text = remove_accents($text);
        }

        return strtolower((string) preg_replace('/\s+/', ' ', $text));
    }
}
