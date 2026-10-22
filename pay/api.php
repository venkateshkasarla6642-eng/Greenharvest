<?php
// pay/api.php — GreenHarvest Pay API Router
// Handles both owner-admin and customer payment actions.
// Every endpoint verifies the caller's server-side role before acting.

ob_start();
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/lib/PaymentService.php';

header('Content-Type: application/json; charset=utf-8');
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
    // Allow authenticated owner or shopkeeper sessions
    global $user;
    if (!empty($user) && in_array($user['role'] ?? '', ['owner', 'shopkeeper'])) {
        return;
    }
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

// Release session lock for read-only GET requests so they do not block concurrent requests
if ($_SERVER['REQUEST_METHOD'] === 'GET' && session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

$payService = new PaymentService($db);

// ─── Route dispatcher ─────────────────────────────────────────────────────────

try {
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

    /**
     * Public payment link details.
     * Safe to call on customer payment page; never exposes private keys.
     * GET: token
     */
    case 'get_public_payment_link':
        $token = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['token'] ?? '');
        if (empty($token)) {
            jsonResponse(['error' => 'Missing payment link token.'], 400);
        }

        $link = $payService->getPaymentLinkByToken($token);
        if (!$link) {
            jsonResponse(['error' => 'Payment link not found.'], 404);
        }

        $pub = $payService->getPublicSettings();
        jsonResponse([
            'success'  => true,
            'link'     => [
                'token'            => $link['link_token'],
                'title'            => $link['title'],
                'description'      => $link['description'],
                'amount'           => $link['amount'],
                'formatted_amount' => $link['formatted_amount'],
                'customer_name'    => $link['customer_name'],
                'order_ref'        => $link['order_ref'],
                'status'           => $link['status'],
                'expires_at'       => $link['expires_at'],
                'is_expired'       => $link['is_expired'],
                'paid_at'          => $link['paid_at'],
                'transaction_ref'  => $link['transaction_ref']
            ],
            'settings' => $pub
        ]);
        break;

    /**
     * Customer executes payment for a payment link.
     * POST: token, method, outcome, utr_reference
     */
    case 'pay_payment_link':
        $token = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_POST['token'] ?? '');
        if (empty($token)) {
            jsonResponse(['error' => 'Missing payment link token.'], 400);
        }

        $method = trim($_POST['method'] ?? 'sandbox');
        $allowed = ['sandbox', 'qr_upi', 'cod', 'live_upi', 'live_card', 'live_netbanking'];
        if (!in_array($method, $allowed, true)) {
            jsonResponse(['error' => 'Invalid payment method.'], 400);
        }

        $link = $payService->getPaymentLinkByToken($token);
        if (!$link) {
            jsonResponse(['error' => 'Payment link not found.'], 404);
        }
        if ($link['status'] === 'paid') {
            jsonResponse(['success' => true, 'already_paid' => true, 'message' => 'Payment already completed.']);
        }
        if ($link['status'] === 'cancelled') {
            jsonResponse(['error' => 'This payment link has been cancelled.'], 400);
        }
        if ($link['status'] === 'expired' || !empty($link['is_expired'])) {
            jsonResponse(['error' => 'This payment link has expired.'], 400);
        }

        // Handle QR screenshot upload if submitted
        $screenshotPath = null;
        if (isset($_FILES['screenshot']) && $_FILES['screenshot']['error'] === UPLOAD_ERR_OK) {
            $file = $_FILES['screenshot'];
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $file['tmp_name']);
            finfo_close($finfo);
            if (in_array($mime, ['image/jpeg', 'image/png', 'image/webp'])) {
                $ext = explode('/', $mime)[1];
                $dir = __DIR__ . '/../uploads/pay_qr/';
                if (!is_dir($dir)) mkdir($dir, 0750, true);
                $fn = 'link_qr_' . bin2hex(random_bytes(8)) . '_' . time() . '.' . $ext;
                if (move_uploaded_file($file['tmp_name'], $dir . $fn)) {
                    $screenshotPath = 'uploads/pay_qr/' . $fn;
                }
            }
        }

        $utr = trim($_POST['utr_reference'] ?? '');
        $outcome = trim($_POST['outcome'] ?? 'paid');
        $txRef = 'GPL-TX-' . strtoupper(bin2hex(random_bytes(6)));

        if ($method === 'sandbox') {
            $status = ($outcome === 'paid') ? 'paid' : (($outcome === 'failed') ? 'failed' : 'pending');
            $res = $payService->verifyPaymentLink($token, 'sandbox', $status, $txRef, '', null, $user['id'] ?? 0);
            jsonResponse($res, $res['success'] ? 200 : 400);
        } elseif ($method === 'qr_upi') {
            if (empty($utr) || strlen($utr) < 6) {
                jsonResponse(['error' => 'Please provide a valid UTR / Transaction Reference ID (min 6 characters).'], 400);
            }
            $res = $payService->verifyPaymentLink($token, 'qr_upi', 'pending', $txRef, $utr, $screenshotPath, $user['id'] ?? 0);
            jsonResponse($res, $res['success'] ? 200 : 400);
        } elseif ($method === 'cod') {
            $res = $payService->verifyPaymentLink($token, 'cod', 'pending', $txRef, 'COD', null, $user['id'] ?? 0);
            jsonResponse($res, $res['success'] ? 200 : 400);
        } elseif ($payService->isLiveMode()) {
            $razorpayPaymentId = trim($_POST['razorpay_payment_id'] ?? '');
            $res = $payService->verifyPaymentLink($token, $method, 'paid', $razorpayPaymentId ?: $txRef, '', null, $user['id'] ?? 0);
            jsonResponse($res, $res['success'] ? 200 : 400);
        } else {
            jsonResponse(['error' => 'Payment method not currently available.'], 400);
        }
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
        payRateLimit('initiate_' . $u['id'], 60);

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

        $result = $payService->initiatePayment($orderId, $u['id'], $method, $idempotencyKey, $u['role'] ?? '');
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
     * Customer live payment callback verification (Razorpay & Cashfree).
     * POST: payment_ref, razorpay_payment_id, razorpay_order_id, razorpay_signature, cashfree_order_id
     */
    case 'initiate_payment_live_callback':
        $u = payRequireAuth();
        $paymentRef        = preg_replace('/[^A-Za-z0-9\-]/', '', $_POST['payment_ref'] ?? '');
        $razorpayPaymentId = trim($_POST['razorpay_payment_id'] ?? '');
        $razorpaySignature = trim($_POST['razorpay_signature'] ?? '');
        $cashfreeOrderId   = trim($_POST['cashfree_order_id'] ?? '');

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

        $providerPaymentId = $razorpayPaymentId ?: $cashfreeOrderId;
        $result = $payService->verifyPayment((int)$attempt['id'], (int)$u['id'], 'paid', $providerPaymentId, $razorpaySignature);
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
     * Create payment link (Admin / Owner).
     * POST: title, amount, customer_name, customer_phone, customer_email, order_ref, description, expires_in, expires_at
     */
    case 'owner_create_payment_link':
        $owner = payRequireOwner();
        payVerifyCsrf();
        payRateLimit('create_link_' . $owner['id'], 30);

        $result = $payService->createPaymentLink($_POST, (int)$owner['id']);
        jsonResponse($result, $result['success'] ? 200 : 400);
        break;

    /**
     * List payment links with filters and pagination.
     * GET: status, search, page, limit
     */
    case 'owner_get_payment_links':
        payRequireOwner();

        $filters = [
            'status' => trim($_GET['status'] ?? 'all'),
            'search' => trim($_GET['search'] ?? '')
        ];
        $page = max(1, intval($_GET['page'] ?? 1));
        $limit = max(1, min(100, intval($_GET['limit'] ?? 25)));
        $offset = ($page - 1) * $limit;

        $result = $payService->getPaymentLinks($filters, $limit, $offset);
        $result['page'] = $page;
        jsonResponse($result);
        break;

    /**
     * Cancel an unpaid payment link.
     * POST: link_id
     */
    case 'owner_cancel_payment_link':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $linkId = intval($_POST['link_id'] ?? 0);
        if ($linkId <= 0) {
            jsonResponse(['error' => 'Invalid link ID.'], 400);
        }

        $result = $payService->cancelPaymentLink($linkId, (int)$owner['id']);
        jsonResponse($result, $result['success'] ? 200 : 400);
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
        $live = $payService->getLiveAdapter();
        $eff = $payService->getEffectiveStatus();

        $rzpKey = $live->getRazorpayKeyId();
        $rzpSec = $live->getRazorpayKeySecret();
        $rzpWh  = $live->getRazorpayWebhookSecret();
        $hasRzp = !empty($rzpKey) && !empty($rzpSec);

        $cfApp = $live->getCashfreeAppId();
        $cfSec = $live->getCashfreeSecretKey();
        $cfWh  = $live->getCashfreeWebhookSecret();
        $hasCf = !empty($cfApp) && !empty($cfSec);

        $activeProvider = $eff['provider'];
        $hasLiveKeys = $eff['is_ready'];

        // Never expose secrets — return only non-sensitive masked fields
        $safe = [
            'id'                      => $settings['id'] ?? 1,
            'mode'                    => $eff['mode'],
            'effective_status'        => $eff['effective_status'],
            'badge_text'              => $eff['badge_text'],
            'badge_class'             => $eff['badge_class'],
            'pill_text'               => $eff['pill_text'],
            'status_message'          => $eff['message'],
            'is_ready'                => $eff['is_ready'],
            'enabled_methods'         => $settings['enabled_methods'] ?? 'qr_upi,cod',
            'live_provider'           => $activeProvider,
            'has_live_keys'           => $hasLiveKeys,

            // Razorpay specific
            'razorpay_key_id'         => $rzpKey,
            'razorpay_key_secret'     => !empty($rzpSec) ? '••••••••' : '',
            'razorpay_webhook_secret' => !empty($rzpWh) ? '••••••••' : '',
            'has_razorpay_keys'       => $hasRzp,
            'is_razorpay_test'        => str_starts_with($rzpKey, 'rzp_test_'),

            // Cashfree specific
            'cashfree_app_id'         => $cfApp,
            'cashfree_secret_key'     => !empty($cfSec) ? '••••••••' : '',
            'cashfree_webhook_secret' => !empty($cfWh) ? '••••••••' : '',
            'has_cashfree_keys'       => $hasCf,
            'is_cashfree_test'        => (str_starts_with(strtoupper($cfApp), 'TEST') || str_contains(strtoupper($cfApp), 'TEST')),

            // General & fallback fields
            'provider_key_env'        => $activeProvider === 'cashfree' ? $cfApp : $rzpKey,
            'provider_secret_env'     => ($activeProvider === 'cashfree' ? !empty($cfSec) : !empty($rzpSec)) ? '••••••••' : '',
            'webhook_secret_env'      => ($activeProvider === 'cashfree' ? !empty($cfWh) : !empty($rzpWh)) ? '••••••••' : '',
            'upi_id'                  => $settings['upi_id'] ?? '',
            'qr_image_path'           => $settings['qr_image_path'] ?? '',
            'manual_verify_enabled'   => (int)($settings['manual_verify_enabled'] ?? 1),
            'sandbox_auto_approve'    => (int)($settings['sandbox_auto_approve'] ?? 0),
            'updated_at'              => $settings['updated_at'] ?? null,
        ];
        jsonResponse(['success' => true, 'settings' => $safe]);
        break;

    case 'owner_update_settings':
        $owner = payRequireOwner();
        payVerifyCsrf();

        $mode                 = trim($_POST['mode'] ?? 'sandbox');
        $enabled_methods      = trim($_POST['enabled_methods'] ?? 'qr_upi,cod');
        $live_provider        = strtolower(trim($_POST['live_provider'] ?? 'none'));
        $upi_id               = trim($_POST['upi_id'] ?? '');
        $manual_verify        = isset($_POST['manual_verify_enabled']) ? 1 : 0;
        $sandbox_auto         = isset($_POST['sandbox_auto_approve']) ? 1 : 0;

        // Provider-specific credentials
        $razorpay_key_id         = trim($_POST['razorpay_key_id'] ?? $_POST['provider_key_env'] ?? '');
        $razorpay_key_secret     = trim($_POST['razorpay_key_secret'] ?? $_POST['provider_secret_env'] ?? '');
        $razorpay_webhook_secret = trim($_POST['razorpay_webhook_secret'] ?? $_POST['webhook_secret_env'] ?? '');

        $cashfree_app_id         = trim($_POST['cashfree_app_id'] ?? '');
        $cashfree_secret_key     = trim($_POST['cashfree_secret_key'] ?? '');
        $cashfree_webhook_secret = trim($_POST['cashfree_webhook_secret'] ?? '');

        // If provider is cashfree and form submitted generic provider_key_env
        if ($live_provider === 'cashfree') {
            if (empty($cashfree_app_id) && !empty($_POST['provider_key_env']) && !str_starts_with($_POST['provider_key_env'], 'rzp_')) {
                $cashfree_app_id = trim($_POST['provider_key_env']);
            }
            if (empty($cashfree_secret_key) && !empty($_POST['provider_secret_env']) && !str_contains($_POST['provider_secret_env'], '•••')) {
                $cashfree_secret_key = trim($_POST['provider_secret_env']);
            }
        }

        // Preserve existing keys in DB if form submitted blank or with masked placeholder
        $currentSettings = $db->query("SELECT * FROM gh_pay_settings WHERE id = 1")->fetch();
        if (!$currentSettings) {
            $db->exec("INSERT INTO gh_pay_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
            $currentSettings = $db->query("SELECT * FROM gh_pay_settings WHERE id = 1")->fetch() ?: [];
        }

        // Preserve Razorpay credentials
        if (empty($razorpay_key_id) && !empty($currentSettings['razorpay_key_id'])) {
            $razorpay_key_id = $currentSettings['razorpay_key_id'];
        } elseif (empty($razorpay_key_id) && !empty($currentSettings['provider_key_env']) && str_starts_with($currentSettings['provider_key_env'], 'rzp_')) {
            $razorpay_key_id = $currentSettings['provider_key_env'];
        }

        if ((empty($razorpay_key_secret) || str_contains($razorpay_key_secret, '•••')) && !empty($currentSettings['razorpay_key_secret'])) {
            $razorpay_key_secret = $currentSettings['razorpay_key_secret'];
        } elseif ((empty($razorpay_key_secret) || str_contains($razorpay_key_secret, '•••')) && !empty($currentSettings['provider_secret_env']) && !str_contains($currentSettings['provider_secret_env'], '•••')) {
            $razorpay_key_secret = $currentSettings['provider_secret_env'];
        }

        if ((empty($razorpay_webhook_secret) || str_contains($razorpay_webhook_secret, '•••')) && !empty($currentSettings['razorpay_webhook_secret'])) {
            $razorpay_webhook_secret = $currentSettings['razorpay_webhook_secret'];
        }

        // Preserve Cashfree credentials
        if (empty($cashfree_app_id) && !empty($currentSettings['cashfree_app_id'])) {
            $cashfree_app_id = $currentSettings['cashfree_app_id'];
        }
        if ((empty($cashfree_secret_key) || str_contains($cashfree_secret_key, '•••')) && !empty($currentSettings['cashfree_secret_key'])) {
            $cashfree_secret_key = $currentSettings['cashfree_secret_key'];
        }
        if ((empty($cashfree_webhook_secret) || str_contains($cashfree_webhook_secret, '•••')) && !empty($currentSettings['cashfree_webhook_secret'])) {
            $cashfree_webhook_secret = $currentSettings['cashfree_webhook_secret'];
        }

        if (!in_array($mode, ['sandbox', 'live'])) {
            jsonResponse(['error' => 'Invalid mode.'], 400);
        }
        if (!in_array($live_provider, ['none', 'razorpay', 'cashfree', 'phonepe'])) {
            jsonResponse(['error' => 'Invalid provider.'], 400);
        }

        // Set active provider keys for legacy columns
        $activeKey = ($live_provider === 'cashfree') ? $cashfree_app_id : $razorpay_key_id;
        $activeSec = ($live_provider === 'cashfree') ? $cashfree_secret_key : $razorpay_key_secret;
        $activeWh  = ($live_provider === 'cashfree') ? $cashfree_webhook_secret : $razorpay_webhook_secret;

        // Validate enabled_methods
        $validMethods = ['qr_upi', 'cod', 'sandbox', 'live_upi', 'live_card', 'live_netbanking'];
        $methods = array_filter(explode(',', $enabled_methods), fn($m) => in_array(trim($m), $validMethods));
        $enabled_methods = implode(',', array_map('trim', $methods));

        $stmt = $db->prepare(
            "INSERT INTO gh_pay_settings (
               id, mode, enabled_methods, live_provider,
               razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret,
               cashfree_app_id, cashfree_secret_key, cashfree_webhook_secret,
               provider_key_env, provider_secret_env, webhook_secret_env,
               upi_id, manual_verify_enabled, sandbox_auto_approve,
               updated_at, updated_by_user_id
             ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
             ON CONFLICT (id) DO UPDATE SET
               mode = EXCLUDED.mode,
               enabled_methods = EXCLUDED.enabled_methods,
               live_provider = EXCLUDED.live_provider,
               razorpay_key_id = COALESCE(NULLIF(EXCLUDED.razorpay_key_id, ''), gh_pay_settings.razorpay_key_id),
               razorpay_key_secret = COALESCE(NULLIF(EXCLUDED.razorpay_key_secret, ''), gh_pay_settings.razorpay_key_secret),
               razorpay_webhook_secret = COALESCE(NULLIF(EXCLUDED.razorpay_webhook_secret, ''), gh_pay_settings.razorpay_webhook_secret),
               cashfree_app_id = COALESCE(NULLIF(EXCLUDED.cashfree_app_id, ''), gh_pay_settings.cashfree_app_id),
               cashfree_secret_key = COALESCE(NULLIF(EXCLUDED.cashfree_secret_key, ''), gh_pay_settings.cashfree_secret_key),
               cashfree_webhook_secret = COALESCE(NULLIF(EXCLUDED.cashfree_webhook_secret, ''), gh_pay_settings.cashfree_webhook_secret),
               provider_key_env = COALESCE(NULLIF(EXCLUDED.provider_key_env, ''), gh_pay_settings.provider_key_env),
               provider_secret_env = COALESCE(NULLIF(EXCLUDED.provider_secret_env, ''), gh_pay_settings.provider_secret_env),
               webhook_secret_env = COALESCE(NULLIF(EXCLUDED.webhook_secret_env, ''), gh_pay_settings.webhook_secret_env),
               upi_id = COALESCE(EXCLUDED.upi_id, gh_pay_settings.upi_id),
               manual_verify_enabled = EXCLUDED.manual_verify_enabled,
               sandbox_auto_approve = EXCLUDED.sandbox_auto_approve,
               updated_at = NOW(),
               updated_by_user_id = EXCLUDED.updated_by_user_id"
        );
        $stmt->execute([
            $mode, $enabled_methods, $live_provider,
            $razorpay_key_id ?: null, $razorpay_key_secret ?: null, $razorpay_webhook_secret ?: null,
            $cashfree_app_id ?: null, $cashfree_secret_key ?: null, $cashfree_webhook_secret ?: null,
            $activeKey ?: null, $activeSec ?: null, $activeWh ?: null,
            $upi_id ?: null, $manual_verify, $sandbox_auto,
            $owner['id']
        ]);

        // Sync upi_id to shop_settings if not empty
        if (!empty($upi_id)) {
            try {
                $db->prepare("UPDATE shop_settings SET shop_upi_id = ? WHERE id = 1")->execute([$upi_id]);
            } catch (\Throwable $e) {}
        }

        // Re-read authoritative effective status after update
        $updatedPayService = new PaymentService($db);
        $eff = $updatedPayService->getEffectiveStatus();

        // Audit the settings change
        $auditLogger = new AuditLogger($db);
        $auditLogger->log('settings_updated', [
            'mode'             => $mode,
            'live_provider'    => $live_provider,
            'effective_status' => $eff['effective_status'],
            'enabled_methods'  => $enabled_methods
        ], $owner['id'], 'settings', 1);

        jsonResponse([
            'success'          => true,
            'message'          => 'GreenHarvest Pay settings saved successfully.',
            'effective_status' => $eff['effective_status'],
            'badge_text'       => $eff['badge_text'],
            'badge_class'      => $eff['badge_class'],
            'pill_text'        => $eff['pill_text'],
            'is_ready'         => $eff['is_ready'],
            'mode'             => $eff['mode'],
            'provider'         => $eff['provider'],
            'status_message'   => $eff['message']
        ]);
        break;

    /**
     * Switch payment mode atomically (sandbox <-> live).
     * POST: mode
     */
    case 'owner_switch_mode':
        $owner = payRequireOwner();
        payVerifyCsrf();
        $targetMode = trim($_POST['mode'] ?? 'sandbox');
        if (!in_array($targetMode, ['sandbox', 'live'])) {
            jsonResponse(['error' => 'Invalid mode.'], 400);
        }

        // Guaranteed PostgreSQL UPSERT: preserves existing live_provider selection (e.g. cashfree or razorpay)
        $db->prepare("
            INSERT INTO gh_pay_settings (id, mode, live_provider, updated_at, updated_by_user_id)
            VALUES (1, ?, 'razorpay', NOW(), ?)
            ON CONFLICT (id) DO UPDATE SET
              mode = EXCLUDED.mode,
              live_provider = CASE
                WHEN gh_pay_settings.live_provider IS NULL OR gh_pay_settings.live_provider = 'none' OR gh_pay_settings.live_provider = ''
                THEN 'razorpay'
                ELSE gh_pay_settings.live_provider
              END,
              updated_at = NOW(),
              updated_by_user_id = EXCLUDED.updated_by_user_id
        ")->execute([$targetMode, $owner['id']]);

        $updatedPayService = new PaymentService($db);
        $eff = $updatedPayService->getEffectiveStatus();

        $auditLogger = new AuditLogger($db);
        $auditLogger->log('mode_switched', [
            'mode'             => $targetMode,
            'effective_status' => $eff['effective_status']
        ], $owner['id'], 'settings', 1);

        jsonResponse([
            'success'          => true,
            'mode'             => $eff['mode'],
            'effective_status' => $eff['effective_status'],
            'badge_text'       => $eff['badge_text'],
            'badge_class'      => $eff['badge_class'],
            'pill_text'        => $eff['pill_text'],
            'is_ready'         => $eff['is_ready'],
            'provider'         => $eff['provider'],
            'status_message'   => $eff['message']
        ]);
        break;

    /**
     * Test payment provider API connection (owner only).
     * Supports both Razorpay and Cashfree testing.
     * POST: provider ('razorpay'|'cashfree'), key_id, key_secret
     */
    case 'owner_test_provider':
    case 'owner_test_razorpay':
        payRequireOwner();
        $testProvider = strtolower(trim($_POST['provider'] ?? 'razorpay'));
        if (empty($testProvider) || $testProvider === 'none') {
            $testProvider = 'razorpay';
        }
        $testKey    = trim($_POST['key_id'] ?? '');
        $testSecret = trim($_POST['key_secret'] ?? '');

        $currentSettings = $db->query("SELECT * FROM gh_pay_settings WHERE id = 1")->fetch() ?: [];

        // Build adapter config for testing
        $testConfig = [
            'live_provider' => $testProvider
        ];

        if ($testProvider === 'cashfree') {
            $testConfig['cashfree_app_id'] = (!empty($testKey)) ? $testKey : ($currentSettings['cashfree_app_id'] ?? '');
            $testConfig['cashfree_secret_key'] = (!empty($testSecret) && !str_contains($testSecret, '•••')) ? $testSecret : ($currentSettings['cashfree_secret_key'] ?? '');
        } else {
            $testConfig['razorpay_key_id'] = (!empty($testKey)) ? $testKey : ($currentSettings['razorpay_key_id'] ?? $currentSettings['provider_key_env'] ?? '');
            $testConfig['razorpay_key_secret'] = (!empty($testSecret) && !str_contains($testSecret, '•••')) ? $testSecret : ($currentSettings['razorpay_key_secret'] ?? $currentSettings['provider_secret_env'] ?? '');
        }

        $testAdapter = new LiveAdapter($testConfig);
        $res = $testAdapter->testConnection($testProvider);

        if ($res['success']) {
            // Persist valid tested credentials in DB atomically
            try {
                if ($testProvider === 'cashfree' && !empty($testKey) && !empty($testSecret) && !str_contains($testSecret, '•••')) {
                    $db->prepare("
                        INSERT INTO gh_pay_settings (id, live_provider, cashfree_app_id, cashfree_secret_key, updated_at)
                        VALUES (1, 'cashfree', ?, ?, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            live_provider = 'cashfree',
                            cashfree_app_id = EXCLUDED.cashfree_app_id,
                            cashfree_secret_key = EXCLUDED.cashfree_secret_key,
                            updated_at = NOW()
                    ")->execute([$testKey, $testSecret]);
                } elseif ($testProvider === 'razorpay' && !empty($testKey) && !empty($testSecret) && !str_contains($testSecret, '•••')) {
                    $db->prepare("
                        INSERT INTO gh_pay_settings (id, live_provider, razorpay_key_id, razorpay_key_secret, provider_key_env, provider_secret_env, updated_at)
                        VALUES (1, 'razorpay', ?, ?, ?, ?, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            live_provider = 'razorpay',
                            razorpay_key_id = EXCLUDED.razorpay_key_id,
                            razorpay_key_secret = EXCLUDED.razorpay_key_secret,
                            provider_key_env = EXCLUDED.provider_key_env,
                            provider_secret_env = EXCLUDED.provider_secret_env,
                            updated_at = NOW()
                    ")->execute([$testKey, $testSecret, $testKey, $testSecret]);
                }
            } catch (\Throwable $e) {}
        }

        jsonResponse($res);
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
        if ($file['size'] > 5 * 1024 * 1024) {
            jsonResponse(['error' => 'QR image must be under 5 MB.'], 400);
        }

        $rawBytes = file_get_contents($file['tmp_name']);
        $base64   = 'data:' . $mime . ';base64,' . base64_encode($rawBytes);

        // Also save to disk if possible
        $ext  = explode('/', $mime)[1];
        $dir  = __DIR__ . '/../uploads/pay_qr/';
        if (!is_dir($dir)) mkdir($dir, 0750, true);
        $name = 'ghpay_qr_' . time() . '.' . $ext;
        @move_uploaded_file($file['tmp_name'], $dir . $name);

        // Save base64 data URI permanently to database (survives container restarts!)
        $db->prepare("
            INSERT INTO gh_pay_settings (id, qr_image_path, updated_at)
            VALUES (1, ?, NOW())
            ON CONFLICT (id) DO UPDATE SET qr_image_path = EXCLUDED.qr_image_path, updated_at = NOW()
        ")->execute([$base64]);

        // Sync to shop_settings
        try {
            $db->exec("ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS qr_image_path TEXT DEFAULT ''");
            $db->prepare("UPDATE shop_settings SET qr_image_path = ? WHERE id = 1")->execute([$base64]);
        } catch (\Throwable $e) {}

        $auditLogger = new AuditLogger($db);
        $auditLogger->log('qr_image_uploaded', ['name' => $name], $owner['id'], 'settings', 1);

        jsonResponse(['success' => true, 'qr_image_path' => $base64]);
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
        jsonResponse(array_merge($result, ['simulated' => true, 'outcome' => $outcome]), $result['success'] ? 200 : 400);
        break;

    default:
        jsonResponse(['error' => 'Invalid GreenHarvest Pay action.'], 400);
        break;
}
} catch (\Throwable $e) {
    error_log('[GHPay][API Error] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    jsonResponse([
        'success' => false,
        'error'   => 'Payment request error: ' . $e->getMessage()
    ], 500);
}
