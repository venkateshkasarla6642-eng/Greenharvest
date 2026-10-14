<?php
// config.php - Database Configuration & Helpers (PostgreSQL)
session_start();

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_USER', getenv('DB_USER') ?: 'postgres');
define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');
define('DB_NAME', getenv('DB_NAME') ?: 'greenharvest');
define('DB_PORT', getenv('DB_PORT') ?: '5432');

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
            $dsn = "pgsql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME;
            $pdo = new GreenPDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE    => PDO::ERRMODE_EXCEPTION,
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
    if (isset($_SESSION['user_id'])) {
        $db = getDB();
        $stmt = $db->prepare("SELECT id, name, phone, email, profile_photo, role, address, house_no, street, city, district, state, pincode FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        return $stmt->fetch();
    }
    return null;
}
