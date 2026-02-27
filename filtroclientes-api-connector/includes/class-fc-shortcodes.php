<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Shortcodes
{
    private static $lastResponseProbe = [];

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
        $apiItems = self::fetch_submissions_live(20, 200);
        if (is_wp_error($apiItems)) {
            return '<div class="notice notice-error"><p>' . esc_html($apiItems->get_error_message()) . '</p></div>';
        }

        $rows = [];
        foreach ($apiItems as $item) {
            $normalized = self::normalize_for_display(isset($item['normalized']) && is_array($item['normalized']) ? $item['normalized'] : []);
            $matchPayload = self::normalize_for_display(isset($item['match']) && is_array($item['match']) ? $item['match'] : []);
            $externalId = self::extract_external_id($item);

            $matchTotal = isset($matchPayload['total_matches']) ? (int) $matchPayload['total_matches'] : 0;
            $row = [
                'external_id' => $externalId,
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
                'created_at' => isset($item['createdAt']) ? self::normalize_string((string) $item['createdAt']) : ''
            ];

            if (!self::row_matches_filters($row, $filters)) {
                continue;
            }

            $rows[] = $row;
        }

        $totalItems = count($rows);
        $totalPages = max(1, (int) ceil($totalItems / $perPage));
        $currentPage = min($currentPage, $totalPages);
        $offset = ($currentPage - 1) * $perPage;
        $pageRows = array_slice($rows, $offset, $perPage);

        ob_start();
        ?>
        <div class="fc-shortcode-table">
            <?php if (empty($apiItems)) : ?>
                <div class="notice notice-warning"><p>
                    API devolvio 0 items para la tabla.
                    <?php if (!empty(self::$lastResponseProbe)) : ?>
                        Debug: <?php echo esc_html(wp_json_encode(self::$lastResponseProbe, JSON_UNESCAPED_UNICODE)); ?>
                    <?php endif; ?>
                </p></div>
            <?php endif; ?>
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
                    <?php if (empty($pageRows)) : ?>
                        <tr><td colspan="10">Sin datos con esos filtros.</td></tr>
                    <?php else : ?>
                        <?php foreach ($pageRows as $row) : ?>
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
                                    <?php if ((string) $row['external_id'] !== '') : ?>
                                        <a class="button button-small" href="<?php echo esc_url(add_query_arg([
                                            'page' => 'fc-record',
                                            'external_id' => (string) $row['external_id']
                                        ], admin_url('admin.php'))); ?>">Abrir ficha</a>
                                    <?php else : ?>
                                        <span class="fc-muted">Sin ID</span>
                                    <?php endif; ?>
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

        return (string) ob_get_clean();
    }

    private static function fetch_submissions_live(int $maxPages, int $limitPerPage)
    {
        $items = [];
        $skip = 0;
        $safePages = max(1, min(100, $maxPages));
        $safeLimit = max(1, min(200, $limitPerPage));
        self::$lastResponseProbe = [];

        for ($page = 0; $page < $safePages; $page++) {
            $response = FC_Api_Client::fetch_submissions($safeLimit, $skip, false);
            if (is_wp_error($response)) {
                return $response;
            }

            if ($page === 0) {
                self::$lastResponseProbe = self::probe_response($response);
            }

            $batch = self::extract_submissions_batch($response);

            foreach ($batch as $item) {
                if (is_array($item)) {
                    $items[] = $item;
                }
            }

            if (count($batch) < $safeLimit) {
                break;
            }
            $skip += $safeLimit;
        }

        return $items;
    }

    private static function extract_submissions_batch($response): array
    {
        if (is_array($response)) {
            if (isset($response['submissions']) && is_array($response['submissions'])) {
                return $response['submissions'];
            }
            if (isset($response['data']) && is_array($response['data'])) {
                return $response['data'];
            }
            if (isset($response['items']) && is_array($response['items'])) {
                return $response['items'];
            }
            if (isset($response['docs']) && is_array($response['docs'])) {
                return $response['docs'];
            }
            if (isset($response['results']) && is_array($response['results'])) {
                return $response['results'];
            }

            $isList = array_keys($response) === range(0, count($response) - 1);
            if ($isList) {
                return $response;
            }

            // Recursive fallback for nested payloads like { data: { items: [...] } }
            foreach ($response as $value) {
                if (is_array($value)) {
                    $nested = self::extract_submissions_batch($value);
                    if (!empty($nested)) {
                        return $nested;
                    }
                }
            }
        }

        return [];
    }

    private static function probe_response($response): array
    {
        if (!is_array($response)) {
            return ['type' => gettype($response)];
        }

        $keys = array_keys($response);
        $probe = [
            'keys' => $keys,
            'total' => isset($response['total']) ? $response['total'] : null,
            'limit' => isset($response['limit']) ? $response['limit'] : null,
            'skip' => isset($response['skip']) ? $response['skip'] : null
        ];

        $batch = self::extract_submissions_batch($response);
        $probe['batch_count'] = is_array($batch) ? count($batch) : 0;

        return $probe;
    }

    private static function row_matches_filters(array $row, array $filters): bool
    {
        if ($filters['match'] === 'with' && !(bool) $row['has_match']) {
            return false;
        }
        if ($filters['match'] === 'without' && (bool) $row['has_match']) {
            return false;
        }

        $contains = static function (string $haystack, string $needle): bool {
            if ($needle === '') {
                return true;
            }
            return strpos(FC_Shortcodes::normalize_filter_term($haystack), $needle) !== false;
        };

        return $contains((string) $row['contact_name'], $filters['contact'])
            && $contains((string) $row['contact_email'], $filters['email'])
            && $contains((string) $row['tipo_enfermedad'], $filters['tipo'])
            && $contains((string) $row['subtipo_enfermedad'], $filters['subtipo'])
            && $contains((string) $row['centro'], $filters['centro'])
            && $contains((string) $row['ciudad'], $filters['ciudad']);
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

    public static function normalize_filter_term(string $value): string
    {
        $value = self::normalize_string($value);
        $value = function_exists('remove_accents') ? remove_accents($value) : $value;
        return strtolower(trim($value));
    }

    public static function normalize_for_display($value)
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

    public static function normalize_string(string $value): string
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

        if (preg_match('/u00[0-9a-fA-F]{2}|Ãƒ|Ã‚/', $value) === 1) {
            $latin1ToUtf8 = @mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
            if (is_string($latin1ToUtf8) && $latin1ToUtf8 !== '') {
                $value = $latin1ToUtf8;
            }
        }

        return trim((string) preg_replace('/\s+/', ' ', $value));
    }

    public static function value_to_string($value): string
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

    private static function extract_external_id(array $item): string
    {
        if (isset($item['_id'])) {
            $raw = $item['_id'];
            if (is_string($raw)) {
                return self::normalize_string($raw);
            }
            if (is_array($raw) && isset($raw['$oid']) && is_string($raw['$oid'])) {
                return self::normalize_string($raw['$oid']);
            }
        }

        if (isset($item['id']) && is_string($item['id'])) {
            return self::normalize_string($item['id']);
        }

        return '';
    }
}
