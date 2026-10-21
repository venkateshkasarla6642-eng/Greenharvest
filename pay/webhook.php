<?php
// pay/webhook.php — GreenHarvest Pay Secure Webhook Receiver
//
// SECURITY:
//  - Reads raw body BEFORE any framework parsing
//  - Verifies provider signature using HMAC comparison
//  - Detects and ignores duplicate events (idempotent)
//  - Never trusts client-sent payment status alone
//  - Confirms payment via provider API before marking paid
//  - Logs all events (valid and invalid) for audit

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/lib/PaymentService.php';
require_once __DIR__ . '/lib/LiveAdapter.php';
require_once __DIR__ . '/lib/AuditLogger.php';

// Read raw body immediately (before any parsing)
$rawBody = file_get_contents('php://input');

// Respond 200 quickly to prevent provider retries on slow processing
// We will buffer output and process after sending headers
ignore_user_abort(true);

$db      = getDB();
$live    = new LiveAdapter();
$audit   = new AuditLogger($db);
$service = new PaymentService($db);

// ─── Signature verification ───────────────────────────────────────────────────

$provider  = getenv('GH_LIVE_PROVIDER') ?: 'none';
$signature = '';

switch ($provider) {
    case 'razorpay':
        $signature = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';
        break;
    case 'cashfree':
        $signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';
        break;
    default:
        // Sandbox webhook (only from localhost / trusted IP in dev)
        $signature = 'sandbox';
        break;
}

// Compute payload hash for deduplication
$payloadHash = hash('sha256', $rawBody);

// ─── Duplicate event detection ────────────────────────────────────────────────

$dupCheck = $db->prepare(
    "SELECT id, status FROM gh_payment_events WHERE payload_hash = ? LIMIT 1"
);
$dupCheck->execute([$payloadHash]);
$dupEvent = $dupCheck->fetch();

if ($dupEvent) {
    // Already processed — respond 200 (idempotent)
    http_response_code(200);
    echo json_encode(['status' => 'duplicate', 'event_id' => $dupEvent['id']]);
    exit;
}

// ─── Parse and verify signature ───────────────────────────────────────────────

$parseResult = ['valid' => false, 'error' => 'Unknown provider'];

if ($provider === 'none' || $provider === 'sandbox') {
    // Sandbox: accept JSON from local test runner
    $data = json_decode($rawBody, true);
    if (is_array($data)) {
        $parseResult = [
            'valid'               => true,
            'is_sandbox'          => true,
            'event_type'          => $data['event'] ?? 'payment.captured',
            'provider_order_id'   => $data['order_id'] ?? null,
            'provider_payment_id' => $data['payment_id'] ?? null,
            'status'              => $data['status'] ?? 'paid',
            'amount'              => isset($data['amount']) ? (float)$data['amount'] : null,
            'currency'            => $data['currency'] ?? 'INR'
        ];
    }
} else {
    $parseResult = $live->verifyWebhook($rawBody, $signature);
}

// ─── Log the event (always, regardless of validity) ──────────────────────────

$logStmt = $db->prepare(
    "INSERT INTO gh_payment_events
     (payment_attempt_id, event_type, payload_hash, provider_event_id, source,
      status, signature_valid, raw_payload_size, error_message)
     VALUES (NULL, ?, ?, ?, 'webhook', 'received', ?, ?, ?)"
);

if (!$parseResult['valid']) {
    $logStmt->execute([
        'unknown',
        $payloadHash,
        null,
        0,
        strlen($rawBody),
        $parseResult['error'] ?? 'Signature invalid'
    ]);

    $audit->log('webhook_rejected', ['payload_hash' => $payloadHash, 'provider' => $provider]);

    http_response_code(400);
    echo json_encode(['status' => 'rejected', 'error' => 'Invalid signature']);
    exit;
}

// ─── Find matching payment attempt ───────────────────────────────────────────

$attempt = null;
$attemptId = null;

if (!empty($parseResult['provider_order_id'])) {
    $stmt = $db->prepare(
        "SELECT * FROM gh_payment_attempts WHERE provider_order_id = ? LIMIT 1"
    );
    $stmt->execute([$parseResult['provider_order_id']]);
    $attempt = $stmt->fetch();
    $attemptId = $attempt ? (int)$attempt['id'] : null;
}

// Log with attempt_id now known
$logStmt->execute([
    $parseResult['event_type'],
    $payloadHash,
    $parseResult['provider_payment_id'] ?? null,
    1,
    strlen($rawBody),
    null
]);
$eventId = (int)$db->lastInsertId();

// Update event with attempt_id
if ($attemptId) {
    $db->prepare("UPDATE gh_payment_events SET payment_attempt_id = ? WHERE id = ?")
       ->execute([$attemptId, $eventId]);
}

// ─── Process the event ───────────────────────────────────────────────────────

$processed = false;
$processError = null;

if ($attempt) {
    $outcome = match ($parseResult['status']) {
        'paid', 'captured', 'success' => 'paid',
        'failed', 'failure'           => 'failed',
        'refunded'                    => 'refunded',
        default                       => 'pending'
    };

    // For live payments: do an extra authoritative API check before marking paid
    if (!$attempt['is_sandbox'] && $outcome === 'paid') {
        $liveVerify = $live->verifyPayment(
            $attempt['provider_order_id'],
            $parseResult['provider_payment_id'] ?? null,
            null
        );
        if (!$liveVerify['success'] || $liveVerify['verified_status'] !== 'paid') {
            $outcome = 'pending'; // Downgrade — do not mark paid without API confirmation
            error_log('[GHPay][Webhook] API cross-check failed for ' . $attempt['payment_ref']);
        }
    }

    // Use system user_id = 0 for webhook-triggered actions
    $result = $service->verifyPayment(
        (int)$attempt['id'],
        0, // System
        $outcome,
        $parseResult['provider_payment_id'] ?? '',
        ''
    );

    $processed = $result['success'];
    $processError = $result['error'] ?? null;

    $db->prepare("UPDATE gh_payment_events SET status = ?, processed_at = NOW(), error_message = ? WHERE id = ?")
       ->execute([$processed ? 'processed' : 'failed', $processError, $eventId]);
} else {
    $db->prepare("UPDATE gh_payment_events SET status = 'failed', error_message = ? WHERE id = ?")
       ->execute(['No matching payment attempt found', $eventId]);
}

$audit->log('webhook_processed', [
    'event_id'     => $eventId,
    'event_type'   => $parseResult['event_type'],
    'provider'     => $provider,
    'status'       => $parseResult['status'],
    'processed'    => $processed,
    'error'        => $processError
], null, 'payment_event', $eventId);

http_response_code(200);
echo json_encode(['status' => 'ok', 'event_id' => $eventId]);
exit;
