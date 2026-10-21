<?php
// config.php - Database Configuration & Helpers (PostgreSQL)
session_start();

// Support DATABASE_URL (external Render connection string) for cross-region deployments
$databaseUrl = getenv('DATABASE_URL');
if ($databaseUrl) {
    $parsed = parse_url($databaseUrl);
    define('DB_HOST', $parsed['host']);
    define('DB_USER', $parsed['user']);
    define('DB_PASS', $parsed['pass'] ?? '');
    define('DB_NAME', ltrim($parsed['path'], '/'));
    define('DB_PORT', $parsed['port'] ?? '5432');
} else {
    define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
    define('DB_USER', getenv('DB_USER') ?: 'postgres');
    define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');
    define('DB_NAME', getenv('DB_NAME') ?: 'greenharvest');
    define('DB_PORT', getenv('DB_PORT') ?: '5432');
}

// PDO subclass that fixes lastInsertId() for PostgreSQL using LASTVAL()
class GreenPDO extends PDO {
    public function lastInsertId(?string $name = null): string|false {
        try {
            return $this->query('SELECT LASTVAL()')->fetchColumn();
        } catch (\Exception $e) {
            return false;
        }
    }
}

function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            // sslmode=require is needed for Render's external PostgreSQL connections
            $dsn = "pgsql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME . ";sslmode=require";
            $pdo = new GreenPDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
        } catch (PDOException $e) {
            jsonResponse(['error' => 'Database connection failed: ' . $e->getMessage()], 500);
        }
    }
    return $pdo;
}

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function getCurrentUser() {
    static $cachedUser = false;
    if ($cachedUser !== false) {
        return $cachedUser;
    }
    if (isset($_SESSION['user_id'])) {
        $db = getDB();
        $stmt = $db->prepare("SELECT id, name, phone, email, profile_photo, role, address, house_no, street, city, district, state, pincode FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $cachedUser = $stmt->fetch() ?: null;
        return $cachedUser;
    }
    $cachedUser = null;
    return null;
}

/**
 * Releases PHP session lock for read-only actions so concurrent requests
 * (like polling vs button clicks) do not block each other.
 */
function closeSessionIfReadOnly(string $action): void {
    $readOnlyActions = [
        'get_current_user',
        'get_shop_settings',
        'get_categories',
        'get_products',
        'get_product_detail',
        'get_customer_orders',
        'get_shop_orders',
        'get_shop_dashboard',
        'get_customer_payments',
        'get_shop_payments',
        'get_notifications',
        'stream_updates',
        'get_addresses',
        'get_reviews',
        'get_offers',
        'get_pay_gateway_status',
        'get_delivery_location',
        'get_chat_messages',
        'get_shop_chat_list'
    ];
    if (in_array($action, $readOnlyActions, true) && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

/**
 * Ensures critical PostgreSQL indexes exist for maximum query performance.
 * Runs once per user session to avoid repeated catalog queries.
 */
function ensurePerformanceIndexes(): void {
    if (!empty($_SESSION['perf_indexes_checked'])) return;
    try {
        $db = getDB();
        $db->exec("
            CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
            CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
            CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
            CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_lookup ON notifications(for_role, is_dismissed);
            CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, is_active);
            CREATE INDEX IF NOT EXISTS idx_customer_addresses_cust ON customer_addresses(customer_id);
        ");
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION['perf_indexes_checked'] = 1;
        }
    } catch (\Throwable $e) {
        // Silently catch
    }
}

/**
 * GreenHarvest Pay: Owner/Admin access check.
 * Call at the top of every owner-only endpoint and page.
 * Grants access to authorized store owners and administrators.
 */
function checkOwnerRole(): array {
    $user = getCurrentUser();
    if (!$user) {
        jsonResponse(['error' => 'Authentication required. Please sign in.'], 401);
    }
    if ($user['role'] !== 'owner' && $user['role'] !== 'shopkeeper') {
        // Do not reveal what role is required — just deny
        jsonResponse(['error' => 'Access denied.'], 403);
    }
    return $user;
}
