<?php
/**
 * Plugin Name: FiltroClientes Connector Pro
 * Description: Sincroniza formularios desde FiltroClientes API, guarda en CPT y entrega panel administrativo profesional.
 * Version: 2.0.0
 * Author: FiltroClientes
 */

if (!defined('ABSPATH')) {
    exit;
}

define('FC_PLUGIN_VERSION', '2.0.0');
define('FC_PLUGIN_FILE', __FILE__);
define('FC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('FC_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once FC_PLUGIN_DIR . 'includes/class-fc-plugin.php';

FC_Plugin::boot();
