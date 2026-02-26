<?php

if (!defined('ABSPATH')) {
    exit;
}

final class FC_Shortcodes
{
    public static function render_submissions_table(array $atts): string
    {
        $atts = shortcode_atts([
            'limit' => '20'
        ], $atts, 'filtroclientes_registros');

        $posts = get_posts([
            'post_type' => FC_CPT::POST_TYPE,
            'post_status' => 'publish',
            'numberposts' => max(1, min(200, (int) $atts['limit'])),
            'orderby' => 'date',
            'order' => 'DESC'
        ]);

        ob_start();
        ?>
        <div class="fc-shortcode-table">
            <table>
                <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Contacto</th>
                    <th>Email</th>
                    <th>Centros</th>
                    <th>ECOG</th>
                    <th>Matches</th>
                </tr>
                </thead>
                <tbody>
                <?php if (empty($posts)) : ?>
                    <tr><td colspan="6">Sin datos.</td></tr>
                <?php else : ?>
                    <?php foreach ($posts as $post) :
                        $date = get_post_meta($post->ID, '_fc_entry_date', true);
                        $name = get_post_meta($post->ID, '_fc_contact_name', true);
                        $email = get_post_meta($post->ID, '_fc_contact_email', true);
                        $centers = json_decode((string) get_post_meta($post->ID, '_fc_centros', true), true);
                        $ecog = get_post_meta($post->ID, '_fc_ecog', true);
                        $matches = (int) get_post_meta($post->ID, '_fc_match_total', true);
                        ?>
                        <tr>
                            <td><?php echo esc_html((string) $date); ?></td>
                            <td><?php echo esc_html((string) $name); ?></td>
                            <td><?php echo esc_html((string) $email); ?></td>
                            <td><?php echo esc_html(is_array($centers) ? implode(', ', $centers) : ''); ?></td>
                            <td><?php echo esc_html((string) $ecog); ?></td>
                            <td><?php echo esc_html((string) $matches); ?></td>
                        </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
        return (string) ob_get_clean();
    }
}
