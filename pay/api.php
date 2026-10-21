<?php
// pay/api.php — GreenHarvest Pay API Router
// Handles both owner-admin and customer payment actions.
// Every endpoint verifies the caller's server-side role before acting.

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/lib/PaymentService.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

$db      = getDB();
$user    = getCurrentUser();
$action  = $_GET['action'] ?? $_POST['action'] ?? '';

// ─── Auth helpers specific to GreenHarvest Pay ───────────────────────────────

function payRequireOwner(): array {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required.'], 401);
    }
    if ($user['role'] !== 'owner' && $user['role'] !== 'shopkeeper') {
        jsonResponse(['error' => 'Access denied. Owner account required.'], 403);
    }
    return $user;
}

function payRequireCustomer(): array {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required.'], 401);
    }
    if ($user['role'] !== 'customer') {
        jsonResponse(['error' => 'Access denied. Customer account required.'], 403);
    }
    return $user;
}

function payRequireAuth(): array {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required.'], 401);
    }
    return $user;
}

// ─── Simple rate limiter (session-based, prevents brute-force) ──────────────

function payRateLimit(string $key, int $maxPerMinute = 10): void {
    $sessionKey = 'pay_rl_' . $key;
    if (!isset($_SESSION[$sessionKey])) {
        $_SESSION[$sessionKey] = ['count' => 0, 'window_start' => time()];
    }
    $rl = &$_SESSION[$sessionKey];
    if (time() - $rl['window_start'] > 60) {
        $rl = ['count' => 0, 'window_start' => time()];
    }
    $rl['count']++;
    if ($rl['count'] > $maxPerMinute) {
        jsonResponse(['error' => 'Too many requests. Please wait a moment.'], 429);
    }
}

// ─── CSRF helper for state-changing POST requests ────────────────────────────

function payVerifyCsrf(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    $token    = $_POST['_csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = $_SESSION['pay_csrf_token'] ?? '';
    if (empty($expected) || !hash_equals($expected, $token)) {
        // Allow JSON bodies that include _csrf
        $raw  = file_get_contents('php://input');
        $body = $raw ? json_decode($raw, true) : [];
        $token = $body['_csrf'] ?? $token;
        if (empty($expected) || !hash_equals($expected, $token)) {
            jsonResponse(['error' => 'Invalid request. Please refresh and try again.'], 403);
        }
    }
}

// Generate CSRF token on first load
if (empty($_SESSION['pay_csrf_token'])) {
    $_SESSION['pay_csrf_token'] = bin2hex(random_bytes(32));
}

$payService = new PaymentService($db);

// ─── Route dispatcher ─────────────────────────────────────────────────────────

switch ($action) {

    // ════════════════════════════════════════════════════════════════════════
    // PUBLIC / CUSTOMER GATEWAY DISCOVERY
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Public gateway status and available channels.
     * Safe to call on checkout page; never exposes private keys.
     */
    case 'get_public_settings':
        $pub = $payService->getPublicSettings();
        $pub['csrf_token'] = $_SESSION['pay_csrf_token'] ?? '';
        jsonResponse($pub);
        break;

    // ════════════════════════════════════════════════════════════════════════
    // CUSTOMER ACTIONS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Initiate a GreenHarvest Pay checkout.
     * POST: order_id, method, idempotency_key
     * Returns: payment_ref, attempt_id, amount, provider data
     */
    case 'initiate_payment':
        $u = payRequireAuth();
        payRateLimit('initiate_' . $u['id'], 15);

        $orderId        = intval($_POST['order_id'] ?? 0);
        $method         = trim($_POST['method'] ?? 'qr_upi');
        $idempotencyKey = trim($_POST['idempotency_key'] ?? '');

        if ($orderId <= 0) {
            jsonResponse(['error' => 'Invalid order ID.'], 400);
        }
        if (empty($idempotencyKey) || strlen($idempotencyKey) < 8) {
            jsonResponse(['error' => 'Missing or invalid idempotency key.'], 400);
        }

        $allowed = ['qr_upi', 'cod', 'sandbox', 'live_upi', 'live_card', 'live_netbanking'];
        if (!in_array($method, $allowed)) {
            jsonResponse(['error' => 'Invalid payment method.'], 400);
        }

        $result = $payService->initiatePayment($orderId, $u['id'], $method, $idempotencyKey);
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * Get payment status for an attempt.
     * GET: payment_ref
     */
    case 'get_payment_status':
        $u = payRequireAuth();

        $paymentRef = preg_replace('/[^A-Za-z0-9\-]/', '', $_GET['payment_ref'] ?? '');
        if (empty($paymentRef)) {
            jsonResponse(['error' => 'Missing payment reference.'], 400);
        }

        $stmt = $db->prepare(
            "SELECT a.*, o.order_number, o.total_amount
             FROM gh_payment_attempts a
             JOIN orders o ON a.order_id = o.id
             WHERE a.payment_ref = ?"
        );
        $stmt->execute([$paymentRef]);
        $attempt = $stmt->fetch();

        if (!$attempt) {
            jsonResponse(['error' => 'Payment not found.'], 404);
        }

        // Customers can only view their own payment
        if ($u['role'] === 'customer' && (int)$attempt['customer_id'] !== (int)$u['id']) {
            jsonResponse(['error' => 'Unauthorized.'], 403);
        }

        jsonResponse([
            'success'     => true,
            'payment_ref' => $attempt['payment_ref'],
            'status'      => $attempt['status'],
            'amount'      => (float)$attempt['amount'],
            'method'      => $attempt['method'],
            'is_sandbox'  => (bool)$attempt['is_sandbox'],
            'order_number'=> $attempt['order_number'],
            'verified_at' => $attempt['verified_at'],
            'created_at'  => $attempt['created_at']
        ]);
        break;

    /**
     * Customer live payment callback verification.
     * POST: payment_ref, razorpay_payment_id, razorpay_order_id, razorpay_signature
     */
    case 'initiate_payment_live_callback':
        $u = payRequireAuth();
        $paymentRef        = preg_replace('/[^A-Za-z0-9\-]/', '', $_POST['payment_ref'] ?? '');
        $razorpayPaymentId = trim($_POST['razorpay_payment_id'] ?? '');
        $razorpaySignature = trim($_POST['razorpay_signature'] ?? '');

        if (empty($paymentRef)) {
            jsonResponse(['error' => 'Missing payment reference.'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM gh_payment_attempts WHERE payment_ref = ?");
        $stmt->execute([$paymentRef]);
        $attempt = $stmt->fetch();

        if (!$attempt) {
            jsonResponse(['error' => 'Payment attempt not found.'], 404);
        }
        if ((int)$attempt['customer_id'] !== (int)$u['id'] && !in_array($u['role'], ['owner', 'shopkeeper'])) {
            jsonResponse(['error' => 'Unauthorized.'], 403);
        }

        $result = $payService->verifyPayment((int)$attempt['id'], (int)$u['id'], 'paid', $razorpayPaymentId, $razorpaySignature);
        jsonResponse($result);
        break;

    /**
     * Submit QR/UPI payment details (UTR + screenshot) for manual verification.
     * POST: payment_ref, utr_reference, screenshot (file)
     */
    case 'submit_qr_payment':
        $u = payRequireAuth();
        payRateLimit('qr_submit_' . $u['id'], 3);

        $paymentRef  = preg_replace('/[^A-Za-z0-9\-]/', '', $_POST['payment_ref'] ?? '');
        $utrRef      = trim($_POST['utr_reference'] ?? '');

        if (empty($paymentRef) || empty($utrRef)) {
            jsonResponse(['error' => 'Payment reference and UTR reference are required.'], 400);
        }

        // Get attempt by ref and verify ownership
        $stmt = $db->prepare("SELECT * FROM gh_payment_attempts WHERE payment_ref = ?");
        $stmt->execute([$paymentRef]);
        $attempt = $stmt->fetch();

        if (!$attempt || (int)$attempt['customer_id'] !== (int)$u['id']) {
            jsonResponse(['error' => 'Payment not found or unauthorized.'], 403);
        }

        // Handle screenshot upload (optional)
        $screenshotPath = null;
        if (isset($_FILES['screenshot']) && $_FILES['screenshot']['error'] === UPLOAD_ERR_OK) {
            $file = $_FILES['screenshot'];

            // Validate file type
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime  = finfo_file($finfo, $file['tmp_name']);
            finfo_close($finfo);

            if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'])) {
                jsonResponse(['error' => 'Screenshot must be JPEG, PNG, or WebP.'], 400);
            }
            if ($file['size'] > 5 * 1024 * 1024) {
                jsonResponse(['error' => 'Screenshot must be under 5 MB.'], 400);
            }

            $ext     = explode('/', $mime)[1];
            $dir     = __DIR__ . '/../uploads/pay_qr/';
            if (!is_dir($dir)) mkdir($dir, 0750, true);

            // Filename: non-guessable
            $filename = 'qr_' . bin2hex(random_bytes(10)) . '_' . time() . '.' . $ext;
            $destPath = $dir . $filename;

            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                jsonResponse(['error' => 'Screenshot upload failed.'], 500);
            }
            $screenshotPath = 'uploads/pay_qr/' . $filename;
        }

        $result = $payService->submitQrPayment(
            (int)$attempt['id'],
            (int)$u['id'],
            $utrRef,
            $screenshotPath
        );
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * Get CSRF token (for JS-based forms).
     * GET: no params
     */
    case 'get_csrf_token':
        payRequireAuth();
        jsonResponse(['success' => true, 'csrf_token' => $_SESSION['pay_csrf_token']]);
        break;

    // ════════════════════════════════════════════════════════════════════════
    // OWNER / ADMIN ACTIONS — require role = 'owner'
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Owner dashboard stats.
     */
    case 'owner_dashboard':
        payRequireOwner();
        $payService->expireOldAttempts();
        $stats = $payService->getDashboardStats();

        // Additional stats from orders table
        $orderStats = $db->query(
            "SELECT
               COUNT(*) as total_orders,
               COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END) as paid_count,
               COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) as total_paid,
               COUNT(CASE WHEN payment_status = 'Pending' THEN 1 END) as pending_count,
               COUNT(CASE WHEN payment_status = 'Failed' THEN 1 END) as failed_count,
               COUNT(CASE WHEN payment_status = 'Refunded' THEN 1 END) as refunded_count
             FROM orders"
        )->fetch();

        jsonResponse([
            'success'     => true,
            'pay_stats'   => $stats,
            'order_stats' => $orderStats
        ]);
        break;

    /**
     * List transactions with filters.
     * GET: status, method, search, date_from, date_to, is_sandbox, page
     */
    case 'owner_transactions':
        payRequireOwner();

        $filters = [
            'status'     => $_GET['status']     ?? 'all',
            'method'     => $_GET['method']     ?? 'all',
            'search'     => trim($_GET['search'] ?? ''),
            'date_from'  => $_GET['date_from']  ?? null,
            'date_to'    => $_GET['date_to']    ?? null,
            'is_sandbox' => isset($_GET['is_sandbox']) ? (int)$_GET['is_sandbox'] : null,
        ];
        $page   = max(1, intval($_GET['page'] ?? 1));
        $limit  = 25;
        $offset = ($page - 1) * $limit;

        $rows = $payService->getTransactionList($filters, $limit, $offset);

        // Never expose provider_signature or raw credentials in list
        foreach ($rows as &$row) {
            unset($row['provider_signature']);
        }

        jsonResponse(['success' => true, 'transactions' => $rows, 'page' => $page]);
        break;

    /**
     * List pending QR verification queue.
     */
    case 'owner_qr_queue':
        payRequireOwner();
        $queue = $payService->getPendingQrSubmissions();
        jsonResponse(['success' => true, 'queue' => $queue, 'count' => count($queue)]);
        break;

    /**
     * Owner approves or rejects a QR submission.
     * POST: submission_id, decision (approved|rejected), reason
     */
    case 'owner_verify_qr':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $submissionId = intval($_POST['submission_id'] ?? 0);
        $decision     = trim($_POST['decision'] ?? '');
        $reason       = trim($_POST['reason'] ?? '');

        if ($submissionId <= 0) {
            jsonResponse(['error' => 'Invalid submission ID.'], 400);
        }

        $result = $payService->verifyQrSubmission($submissionId, $owner['id'], $decision, $reason);
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * Owner manually verifies a payment attempt.
     * POST: attempt_id, outcome (paid|failed|pending)
     */
    case 'owner_verify_payment':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $attemptId = intval($_POST['attempt_id'] ?? 0);
        $outcome   = trim($_POST['outcome'] ?? 'paid');

        if ($attemptId <= 0) {
            jsonResponse(['error' => 'Invalid attempt ID.'], 400);
        }
        if (!in_array($outcome, ['paid', 'failed', 'pending', 'cancelled'])) {
            jsonResponse(['error' => 'Invalid outcome.'], 400);
        }

        $result = $payService->verifyPayment($attemptId, $owner['id'], $outcome);
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * Owner issues a refund.
     * POST: attempt_id, reason
     */
    case 'owner_refund':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $attemptId = intval($_POST['attempt_id'] ?? 0);
        $reason    = trim($_POST['reason'] ?? '');

        if ($attemptId <= 0) {
            jsonResponse(['error' => 'Invalid attempt ID.'], 400);
        }

        $result = $payService->refundPayment($attemptId, $owner['id'], $reason);
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * Get audit log.
     * GET: page, action_filter
     */
    case 'owner_audit_log':
        payRequireOwner();

        $page   = max(1, intval($_GET['page'] ?? 1));
        $limit  = 30;
        $offset = ($page - 1) * $limit;
        $filter = trim($_GET['action_filter'] ?? '');

        $where  = [];
        $params = [];
        if ($filter) {
            $where[]  = 'action LIKE ?';
            $params[] = '%' . $filter . '%';
        }
        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $stmt = $db->prepare(
            "SELECT l.*, u.name as user_name, u.role as user_role_name
             FROM gh_audit_log l
             LEFT JOIN users u ON l.user_id = u.id
             $whereClause
             ORDER BY l.id DESC LIMIT ? OFFSET ?"
        );
        $stmt->execute(array_merge($params, [$limit, $offset]));
        $logs = $stmt->fetchAll();

        // Never return IP addresses in response (privacy)
        foreach ($logs as &$log) {
            unset($log['ip_address'], $log['user_agent']);
        }

        jsonResponse(['success' => true, 'logs' => $logs, 'page' => $page]);
        break;

    /**
     * Get / update GreenHarvest Pay settings (owner only).
     */
    case 'owner_get_settings':
        payRequireOwner();
        $settings = $payService->getSettings();
        // Never expose secrets — return only non-sensitive fields
        $safe = [
            'id'                   => $settings['id'] ?? 1,
            'mode'                 => $settings['mode'] ?? 'sandbox',
            'enabled_methods'      => $settings['enabled_methods'] ?? 'qr_upi,cod',
            'live_provider'        => $settings['live_provider'] ?? 'none',
            'provider_key_env'     => $settings['provider_key_env'] ?? '',
            'provider_secret_env'  => $settings['provider_secret_env'] ?? '',
            'webhook_secret_env'   => $settings['webhook_secret_env'] ?? '',
            'upi_id'               => $settings['upi_id'] ?? '',
            'qr_image_path'        => $settings['qr_image_path'] ?? '',
            'manual_verify_enabled'=> (int)($settings['manual_verify_enabled'] ?? 1),
            'sandbox_auto_approve' => (int)($settings['sandbox_auto_approve'] ?? 0),
            'updated_at'           => $settings['updated_at'] ?? null,
        ];
        jsonResponse(['success' => true, 'settings' => $safe]);
        break;

    case 'owner_update_settings':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $mode                 = trim($_POST['mode'] ?? 'sandbox');
        $enabled_methods      = trim($_POST['enabled_methods'] ?? 'qr_upi,cod');
        $live_provider        = trim($_POST['live_provider'] ?? 'none');
        $provider_key_env     = trim($_POST['provider_key_env'] ?? '');
        $provider_secret_env  = trim($_POST['provider_secret_env'] ?? '');
        $webhook_secret_env   = trim($_POST['webhook_secret_env'] ?? '');
        $upi_id               = trim($_POST['upi_id'] ?? '');
        $manual_verify        = isset($_POST['manual_verify_enabled']) ? 1 : 0;
        $sandbox_auto         = isset($_POST['sandbox_auto_approve']) ? 1 : 0;

        if (!in_array($mode, ['sandbox', 'live'])) {
            jsonResponse(['error' => 'Invalid mode.'], 400);
        }
        if (!in_array($live_provider, ['none', 'razorpay', 'cashfree', 'phonepe'])) {
            jsonResponse(['error' => 'Invalid provider.'], 400);
        }

        // Validate enabled_methods
        $validMethods = ['qr_upi', 'cod', 'sandbox', 'live_upi', 'live_card', 'live_netbanking'];
        $methods = array_filter(explode(',', $enabled_methods), fn($m) => in_array(trim($m), $validMethods));
        $enabled_methods = implode(',', array_map('trim', $methods));

        $stmt = $db->prepare(
            "UPDATE gh_pay_settings SET
               mode = ?, enabled_methods = ?, live_provider = ?,
               provider_key_env = ?, provider_secret_env = ?, webhook_secret_env = ?,
               upi_id = ?, manual_verify_enabled = ?, sandbox_auto_approve = ?,
               updated_at = NOW(), updated_by_user_id = ?
             WHERE id = 1"
        );
        $stmt->execute([
            $mode, $enabled_methods, $live_provider,
            $provider_key_env ?: null, $provider_secret_env ?: null, $webhook_secret_env ?: null,
            $upi_id ?: null, $manual_verify, $sandbox_auto,
            $owner['id']
        ]);

        // Audit the settings change
        $auditLogger = new AuditLogger($db);
        $auditLogger->log('settings_updated', [
            'mode'            => $mode,
            'live_provider'   => $live_provider,
            'enabled_methods' => $enabled_methods
        ], $owner['id'], 'settings', 1);

        jsonResponse(['success' => true, 'message' => 'GreenHarvest Pay settings updated.']);
        break;

    /**
     * Upload QR code image (owner only).
     * POST: qr_image (file)
     */
    case 'owner_upload_qr':
        $owner = payRequireOwner();

        if (!isset($_FILES['qr_image']) || $_FILES['qr_image']['error'] !== UPLOAD_ERR_OK) {
            jsonResponse(['error' => 'QR image upload failed.'], 400);
        }
        $file  = $_FILES['qr_image'];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'])) {
            jsonResponse(['error' => 'QR image must be JPEG, PNG, or WebP.'], 400);
        }
        if ($file['size'] > 2 * 1024 * 1024) {
            jsonResponse(['error' => 'QR image must be under 2 MB.'], 400);
        }

        $ext  = explode('/', $mime)[1];
        $dir  = __DIR__ . '/../uploads/pay_qr/';
        if (!is_dir($dir)) mkdir($dir, 0750, true);
        $name = 'ghpay_qr_' . time() . '.' . $ext;
        $dest = $dir . $name;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            jsonResponse(['error' => 'Failed to save QR image.'], 500);
        }

        $path = 'uploads/pay_qr/' . $name;
        $db->prepare("UPDATE gh_pay_settings SET qr_image_path = ? WHERE id = 1")->execute([$path]);

        $auditLogger = new AuditLogger($db);
        $auditLogger->log('qr_image_uploaded', ['path' => $path], $owner['id'], 'settings', 1);

        jsonResponse(['success' => true, 'qr_image_path' => $path]);
        break;

    /**
     * CSV export of transactions.
     */
    case 'owner_export_csv':
        payRequireOwner();

        $filters = [
            'status'    => $_GET['status']    ?? 'all',
            'date_from' => $_GET['date_from'] ?? null,
            'date_to'   => $_GET['date_to']   ?? null,
        ];

        $rows = $payService->getTransactionList($filters, 1000, 0);

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="ghpay_transactions_' . date('Ymd_His') . '.csv"');
        header('Cache-Control: no-cache');
        header('X-Content-Type-Options: nosniff');

        $out = fopen('php://output', 'w');
        fputcsv($out, ['Payment Ref', 'Order Number', 'Customer', 'Amount (INR)', 'Method', 'Status', 'Sandbox', 'Created At', 'Verified At']);
        foreach ($rows as $r) {
            fputcsv($out, [
                $r['payment_ref'],
                $r['order_number'],
                $r['customer_name'],
                number_format((float)$r['amount'], 2, '.', ''),
                $r['method'],
                $r['status'],
                $r['is_sandbox'] ? 'TEST' : 'LIVE',
                $r['created_at'],
                $r['verified_at'] ?? ''
            ]);
        }
        fclose($out);
        exit;

    /**
     * Webhook endpoint — receives events from payment provider.
     * No auth session needed; validated by signature.
     */
    case 'webhook':
        // Webhook handled by separate pay/webhook.php for clean separation
        jsonResponse(['error' => 'Use /pay/webhook.php for webhook events.'], 400);
        break;

    /**
     * Sandbox: simulate payment outcome (owner or customer during sandbox testing).
     * POST: payment_ref, outcome
     */
    case 'sandbox_simulate':
        $u = payRequireAuth();
        if (!in_array($u['role'], ['owner', 'shopkeeper', 'customer'])) {
            jsonResponse(['error' => 'Unauthorized.'], 403);
        }

        $paymentRef = preg_replace('/[^A-Za-z0-9\-]/', '', $_POST['payment_ref'] ?? '');
        $outcome    = trim($_POST['outcome'] ?? 'paid');

        if (empty($paymentRef)) jsonResponse(['error' => 'Missing payment reference.'], 400);
        if (!in_array($outcome, ['paid', 'failed', 'pending', 'cancelled'])) {
            jsonResponse(['error' => 'Invalid outcome for sandbox.'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM gh_payment_attempts WHERE payment_ref = ?");
        $stmt->execute([$paymentRef]);
        $attempt = $stmt->fetch();

        if (!$attempt) {
            jsonResponse(['error' => 'Payment not found.'], 404);
        }
        if (!(bool)$attempt['is_sandbox']) {
            jsonResponse(['error' => 'This endpoint is only for sandbox payments.'], 400);
        }
        if ($u['role'] === 'customer' && (int)$attempt['customer_id'] !== (int)$u['id']) {
            jsonResponse(['error' => 'Unauthorized.'], 403);
        }

        $result = $payService->verifyPayment((int)$attempt['id'], (int)$u['id'], $outcome);
        jsonResponse(array_merge($result, ['simulated' => true, 'outcome' => $outcome]));
        break;

    default:
        jsonResponse(['error' => 'Invalid GreenHarvest Pay action.'], 400);
        break;
}
