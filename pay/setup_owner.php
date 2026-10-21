<?php
// pay/setup_owner.php — Secure Owner Account Setup Script
//
// PURPOSE: Creates the first owner account in the database.
// This script is the ONLY legitimate way to create an owner account.
// Delete or disable this file after first use in production.
//
// USAGE:
//   php pay/setup_owner.php
//   (Run from project root via Render Shell, SSH, or XAMPP shell)
//
// SECURITY:
//   - Never expose this file via HTTP. Add to .gitignore and server deny rules.
//   - Only run once. After owner is created, remove this file from production.
//   - Never set a predictable password.
//   - Run only with a secure, randomly-generated password.
//
// EXAMPLE (run in terminal, not browser):
//   php pay/setup_owner.php --name="Your Name" --phone="9876543210" --email="you@example.com" --password="YourSecurePass123!"

// Prevent browser access
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "This script must be run from the command line only.\n";
    exit(1);
}

require_once __DIR__ . '/../config.php';

// ─── Parse CLI arguments ──────────────────────────────────────────────────────

function getArg(string $name, array $argv): ?string {
    foreach ($argv as $arg) {
        if (str_starts_with($arg, "--$name=")) {
            return substr($arg, strlen("--$name="));
        }
    }
    return null;
}

$name     = getArg('name',     $argv) ?? trim(readline("Owner full name: ") ?: '');
$phone    = getArg('phone',    $argv) ?? trim(readline("Phone number: ") ?: '');
$email    = getArg('email',    $argv) ?? trim(readline("Email address: ") ?: '');
$password = getArg('password', $argv) ?? trim(readline("Password (will be hashed): ") ?: '');

if (!$name || !$phone || !$password) {
    echo "ERROR: name, phone, and password are required.\n";
    echo "Usage: php pay/setup_owner.php --name=\"Name\" --phone=\"10digitphone\" --email=\"e@mail.com\" --password=\"SecurePass!\"\n";
    exit(1);
}

if (!preg_match('/^[0-9]{10}$/', $phone)) {
    echo "ERROR: Phone must be a 10-digit number.\n";
    exit(1);
}

if (strlen($password) < 10) {
    echo "ERROR: Password must be at least 10 characters.\n";
    exit(1);
}

// ─── Verify migration ran ──────────────────────────────────────────────────────

$db = getDB();

try {
    $check = $db->query("SELECT COUNT(*) FROM gh_pay_settings")->fetchColumn();
} catch (\Exception $e) {
    echo "ERROR: GreenHarvest Pay tables not found.\n";
    echo "Please run the migration first: psql \$DATABASE_URL -f pay/migrations/001_greenharvest_pay.sql\n";
    exit(1);
}

// ─── Check for existing owner ─────────────────────────────────────────────────

$existing = $db->query("SELECT id, name, phone FROM users WHERE role = 'owner' LIMIT 1")->fetch();
if ($existing) {
    echo "WARNING: An owner account already exists:\n";
    echo "  Name:  {$existing['name']}\n";
    echo "  Phone: {$existing['phone']}\n";
    echo "  ID:    {$existing['id']}\n\n";
    echo "Do you want to create an additional owner anyway? (y/N): ";
    $confirm = trim(readline() ?: '');
    if (strtolower($confirm) !== 'y') {
        echo "Aborted. No changes made.\n";
        exit(0);
    }
}

// ─── Check if phone already registered ────────────────────────────────────────

$taken = $db->prepare("SELECT id FROM users WHERE phone = ?")->execute([$phone]);
$dup   = $db->prepare("SELECT id, role FROM users WHERE phone = ?");
$dup->execute([$phone]);
$dupRow = $dup->fetch();

if ($dupRow) {
    echo "WARNING: Phone $phone is already registered as role: {$dupRow['role']}.\n";
    if ($dupRow['role'] !== 'owner') {
        echo "Do you want to update this account to owner role? (y/N): ";
        $confirm = trim(readline() ?: '');
        if (strtolower($confirm) === 'y') {
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $db->prepare("UPDATE users SET role = 'owner', name = ?, email = ?, password = ? WHERE id = ?")
               ->execute([$name, $email, $hash, $dupRow['id']]);
            echo "\n✅ Account updated to owner role.\n";
            echo "   User ID: {$dupRow['id']}\n";
            echo "   Phone:   $phone\n\n";
            echo "⚠️  IMPORTANT: Delete this setup script before deploying to production.\n";
            exit(0);
        }
    }
    echo "Aborted.\n";
    exit(1);
}

// ─── Create new owner account ─────────────────────────────────────────────────

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = $db->prepare(
    "INSERT INTO users (name, phone, email, password, role)
     VALUES (?, ?, ?, ?, 'owner')"
);
$stmt->execute([$name, $phone, $email, $hash]);
$newId = $db->lastInsertId();

echo "\n✅ Owner account created successfully!\n";
echo "   User ID:  $newId\n";
echo "   Name:     $name\n";
echo "   Phone:    $phone\n";
echo "   Email:    $email\n";
echo "   Role:     owner\n\n";
echo "Login URL: " . (getenv('APP_URL') ?: 'https://your-app.onrender.com') . "\n";
echo "Admin Dashboard: " . (getenv('APP_URL') ?: 'https://your-app.onrender.com') . "/pay/admin.php\n\n";
echo "⚠️  IMPORTANT SECURITY ACTIONS:\n";
echo "   1. Store your credentials securely — they cannot be recovered.\n";
echo "   2. Delete or deny HTTP access to this setup script after use.\n";
echo "   3. Never commit real passwords to git history.\n";
echo "   4. Run the database migration before first login: pay/migrations/001_greenharvest_pay.sql\n\n";
