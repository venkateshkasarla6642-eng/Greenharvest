<?php
// config.php - Database Configuration & Helpers
session_start();

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'vegetable_shop_db');

function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            // First connect without DB name to ensure database exists
            $pdo = new PDO("mysql:host=" . DB_HOST . ";charset=utf8mb4", DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("USE `" . DB_NAME . "`");
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
