<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Shortcodes
{
    public static function render_submissions_table(array $atts): string
    {
        $atts = shortcode_atts([
            'limit' => '20',
            'page_param' => 'fc_page'
        ], $atts, 'filtroclientes_registros');

        $perPage = max(1, min(200, (int) $atts['limit']));
        $pageParam = sanitize_key((string) $atts['page_param']);
        if ($pageParam === '') {
            $pageParam = 'fc_page';
        }

        $currentPage = isset($_GET[$pageParam]) ? (int) $_GET[$pageParam] : 1;
        if ($currentPage < 1) {
            $currentPage = 1;
        }

        $filters = self::read_filters();

        $metaQuery = ['relation' => 'AND'];
        if ($filters['match'] === 'with') {
            $metaQuery[] = [
                'key' => '_fc_match_total',
                'value' => 0,
                'compare' => '>',
                'type' => 'NUMERIC'
            ];
        } elseif ($filters['match'] === 'without') {
            $metaQuery[] = [
                'key' => '_fc_match_total',
                'value' => 0,
                'compare' => '=',
                'type' => 'NUMERIC'
            ];
        }

        $filterMap = [
            'contact' => '_fc_filter_contact',
            'email' => '_fc_filter_email',
            'tipo' => '_fc_filter_tipo',
            'subtipo' => '_fc_filter_subtipo',
            'centro' => '_fc_filter_centro',
            'ciudad' => '_fc_filter_ciudad'
        ];

        foreach ($filterMap as $field => $metaKey) {
            if ($filters[$field] !== '') {
                $metaQuery[] = [
                    'key' => $metaKey,
                    'value' => $filters[$field],
                    'compare' => 'LIKE'
                ];
            }
        }

        $queryArgs = [
            'post_type' => FC_CPT::POST_TYPE,
            'post_status' => 'publish',
            'posts_per_page' => $perPage,
            'paged' => $currentPage,
            'orderby' => 'date',
            'order' => 'DESC',
            'no_found_rows' => false
        ];

        if (count($metaQuery) > 1) {
            $queryArgs['meta_query'] = $metaQuery;
        }

        $query = new WP_Query($queryArgs);

        $rows = [];
        foreach ($query->posts as $post) {
            $postId = (int) $post->ID;
            $normalized = self::normalize_for_display(self::decode_meta_json($postId, '_fc_normalized_payload'));
            $matchPayload = self::normalize_for_display(self::decode_meta_json($postId, '_fc_match_payload'));
            $createdAt = self::normalize_string((string) get_post_meta($postId, '_fc_created_at', true));

            $matchTotal = isset($matchPayload['total_matches']) ? (int) $matchPayload['total_matches'] : 0;

            $rows[] = [
                'post_id' => $postId,
                'entry_date' => isset($normalized['entry_date']) ? self::value_to_string($normalized['entry_date']) : '',
                'contact_name' => isset($normalized['contacto_nombre']) ? self::value_to_string($normalized['contacto_nombre']) : '',
                'contact_email' => isset($normalized['contacto_email']) ? self::value_to_string($normalized['contacto_email']) : '',
                'tipo_enfermedad' => isset($normalized['tipo_enfermedad']) ? self::value_to_string($normalized['tipo_enfermedad']) : '',
                'subtipo_enfermedad' => isset($normalized['subtipo_enfermedad']) ? self::value_to_string($normalized['subtipo_enfermedad']) : '',
                'centro' => self::value_to_string($normalized['centro'] ?? ''),
                'ciudad' => isset($normalized['ciudad']) ? self::value_to_string($normalized['ciudad']) : '',
                'ecog_score' => isset($matchPayload['ecog_score']) ? self::value_to_string($matchPayload['ecog_score']) : '',
                'match_total' => $matchTotal,
                'has_match' => $matchTotal > 0,
                'created_at' => $createdAt
            ];
        }

        $totalPages = max(1, (int) $query->max_num_pages);
        $totalItems = (int) $query->found_posts;

        ob_start();
        ?>
        <div class="fc-shortcode-table">
            <form method="get" class="fc-filters">
                <input type="hidden" name="page" value="<?php echo esc_attr(isset($_GET['page']) ? (string) $_GET['page'] : 'fc-dashboard'); ?>">
                <div class="fc-filters-grid">
                    <select name="fc_f_match">
                        <option value="all" <?php selected($filters['match'], 'all'); ?>>Todos</option>
                        <option value="with" <?php selected($filters['match'], 'with'); ?>>Con match</option>
                        <option value="without" <?php selected($filters['match'], 'without'); ?>>Sin match</option>
                    </select>
                    <input type="text" name="fc_f_contact" placeholder="Contacto" value="<?php echo esc_attr(self::raw_filter_value('fc_f_contact')); ?>">
                    <input type="text" name="fc_f_email" placeholder="Email" value="<?php echo esc_attr(self::raw_filter_value('fc_f_email')); ?>">
                    <input type="text" name="fc_f_tipo" placeholder="Tipo enfermedad" value="<?php echo esc_attr(self::raw_filter_value('fc_f_tipo')); ?>">
                    <input type="text" name="fc_f_subtipo" placeholder="Subtipo" value="<?php echo esc_attr(self::raw_filter_value('fc_f_subtipo')); ?>">
                    <input type="text" name="fc_f_centro" placeholder="Centro" value="<?php echo esc_attr(self::raw_filter_value('fc_f_centro')); ?>">
                    <input type="text" name="fc_f_ciudad" placeholder="Ciudad" value="<?php echo esc_attr(self::raw_filter_value('fc_f_ciudad')); ?>">
                </div>
                <div class="fc-filters-actions">
                    <button class="button button-primary" type="submit">Filtrar</button>
                    <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . (isset($_GET['page']) ? sanitize_key((string) $_GET['page']) : 'fc-dashboard'))); ?>">Limpiar</a>
                </div>
            </form>

            <div class="fc-table-summary"><strong><?php echo esc_html((string) $totalItems); ?></strong> registros</div>

            <div class="fc-table-wrap">
                <table>
                    <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Contacto</th>
                        <th>Email</th>
                        <th>Tipo</th>
                        <th>Subtipo</th>
                        <th>Centro</th>
                        <th>Ciudad</th>
                        <th>ECOG</th>
                        <th>Match</th>
                        <th>Detalle</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php if (empty($rows)) : ?>
                        <tr><td colspan="10">Sin datos con esos filtros.</td></tr>
                    <?php else : ?>
                        <?php foreach ($rows as $row) : ?>
                            <tr>
                                <td><?php echo esc_html((string) ($row['entry_date'] !== '' ? $row['entry_date'] : $row['created_at'])); ?></td>
                                <td><?php echo esc_html((string) $row['contact_name']); ?></td>
                                <td><?php echo esc_html((string) $row['contact_email']); ?></td>
                                <td><?php echo esc_html((string) $row['tipo_enfermedad']); ?></td>
                                <td><?php echo esc_html((string) $row['subtipo_enfermedad']); ?></td>
                                <td><?php echo esc_html((string) $row['centro']); ?></td>
                                <td><?php echo esc_html((string) $row['ciudad']); ?></td>
                                <td><?php echo esc_html((string) $row['ecog_score']); ?></td>
                                <td>
                                    <span class="fc-badge <?php echo $row['has_match'] ? 'fc-badge--ok' : 'fc-badge--no'; ?>">
                                        <?php echo $row['has_match'] ? esc_html('Con match (' . (string) $row['match_total'] . ')') : esc_html('Sin match'); ?>
                                    </span>
                                </td>
                                <td>
                                    <a class="button button-small" href="<?php echo esc_url(add_query_arg([
                                        'page' => 'fc-record',
                                        'record_id' => (int) $row['post_id']
                                    ], admin_url('admin.php'))); ?>">Abrir ficha</a>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>

            <div class="fc-pagination">
                <?php
                $prevPage = max(1, $currentPage - 1);
                $nextPage = min($totalPages, $currentPage + 1);
                ?>
                <a class="button <?php echo $currentPage <= 1 ? 'disabled' : ''; ?>" href="<?php echo esc_url($currentPage <= 1 ? '#' : add_query_arg([$pageParam => $prevPage])); ?>">Anterior</a>
                <span class="fc-pagination-info"><?php echo esc_html(sprintf('Pagina %d de %d', $currentPage, $totalPages)); ?></span>
                <a class="button <?php echo $currentPage >= $totalPages ? 'disabled' : ''; ?>" href="<?php echo esc_url($currentPage >= $totalPages ? '#' : add_query_arg([$pageParam => $nextPage])); ?>">Siguiente</a>
            </div>
        </div>
        <?php

        wp_reset_postdata();
        return (string) ob_get_clean();
    }

    private static function read_filters(): array
    {
        return [
            'match' => self::normalize_match_filter(self::raw_filter_value('fc_f_match')),
            'contact' => self::normalize_filter_term(self::raw_filter_value('fc_f_contact')),
            'email' => self::normalize_filter_term(self::raw_filter_value('fc_f_email')),
            'tipo' => self::normalize_filter_term(self::raw_filter_value('fc_f_tipo')),
            'subtipo' => self::normalize_filter_term(self::raw_filter_value('fc_f_subtipo')),
            'centro' => self::normalize_filter_term(self::raw_filter_value('fc_f_centro')),
            'ciudad' => self::normalize_filter_term(self::raw_filter_value('fc_f_ciudad'))
        ];
    }

    private static function raw_filter_value(string $key): string
    {
        return isset($_GET[$key]) ? sanitize_text_field(wp_unslash((string) $_GET[$key])) : '';
    }

    private static function normalize_match_filter(string $value): string
    {
        $value = strtolower(trim($value));
        if ($value === 'with' || $value === 'without') {
            return $value;
        }
        return 'all';
    }

    private static function normalize_filter_term(string $value): string
    {
        $value = self::normalize_string($value);
        $value = function_exists('remove_accents') ? remove_accents($value) : $value;
        return strtolower(trim($value));
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

        $value = (string) preg_replace_callback('/(?<!\\\\)u([0-9a-fA-F]{4})/', static function ($m) {
            return html_entity_decode('&#x' . strtolower((string) $m[1]) . ';', ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }, $value);

        if (preg_match('/u00[0-9a-fA-F]{2}|Ã|Â/', $value) === 1) {
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
