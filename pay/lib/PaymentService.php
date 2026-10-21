<?php
// pay/lib/PaymentService.php — GreenHarvest Pay Core Payment Orchestration
// Handles: initiation, verification, state transitions, idempotency,
//          QR submission, refunds, and reconciliation.
//
// Security rules enforced here:
//  - Amount always taken from DB (server-calculated), never from client
//  - Payment state machine: only valid transitions allowed
//  - Idempotency keys prevent duplicate initiations
//  - Atomic DB transactions used for state changes

require_once __DIR__ . '/AuditLogger.php';
require_once __DIR__ . '/SandboxAdapter.php';
require_once __DIR__ . '/LiveAdapter.php';

class PaymentService {

    private PDO           $db;
    private AuditLogger   $audit;
    private SandboxAdapter $sandbox;
    private LiveAdapter   $live;
    private array         $settings;

    // Valid state transitions
    private const TRANSITIONS = [
        'initiated'  => ['pending', 'processing', 'paid', 'failed', 'cancelled', 'expired'],
        'pending'    => ['processing', 'paid', 'failed', 'cancelled', 'expired'],
        'processing' => ['paid', 'failed', 'cancelled'],
        'paid'       => ['refunded'],   // Only refund from paid
        'failed'     => ['initiated', 'pending', 'paid'],  // Allow retry
        'cancelled'  => ['initiated'],             // Allow retry
        'expired'    => ['initiated'],  // Allow retry
        'refunded'   => [],             // Terminal
    ];

    public function __construct(PDO $db) {
        $this->db      = $db;
        $this->audit   = new AuditLogger($db);
        $this->sandbox = new SandboxAdapter();
        $this->live    = new LiveAdapter();
        $this->ensureSchema();
        $this->settings = $this->loadSettings();
    }

    // ─── Auto-migration ──────────────────────────────────────────────────────

    private function ensureSchema(): void {
        static $checked = false;
        if ($checked) return;
        $checked = true;
        try {
            $exists = $this->db->query("SELECT 1 FROM information_schema.tables WHERE table_name = 'gh_pay_settings'")->fetchColumn();
            if (!$exists) {
                $this->runMigration();
            }
        } catch (\Throwable $e) {
            error_log('[GHPay] ensureSchema check error: ' . $e->getMessage());
        }
    }

    private function runMigration(): void {
        $file = __DIR__ . '/../migrations/001_greenharvest_pay.sql';
        if (!file_exists($file)) return;
        $sql = file_get_contents($file);

        $statements = [];
        $current = '';
        $inDollarQuote = false;
        $lines = explode("\n", $sql);
        foreach ($lines as $line) {
            $current .= $line . "\n";
            if (substr_count($line, '$$') % 2 !== 0) {
                $inDollarQuote = !$inDollarQuote;
            }
            if (!$inDollarQuote && (str_ends_with(rtrim($line), ';') || rtrim($line) === '$$')) {
                $trimmed = trim($current);
                if (!empty($trimmed) && $trimmed !== 'BEGIN;' && $trimmed !== 'COMMIT;') {
                    $statements[] = $trimmed;
                }
                $current = '';
            }
        }
        if (!empty(trim($current)) && trim($current) !== 'BEGIN;' && trim($current) !== 'COMMIT;') {
            $statements[] = trim($current);
        }

        foreach ($statements as $stmt) {
            $t = trim($stmt);
            if (!empty($t) && $t !== ';') {
                try {
                    $this->db->exec($t);
                } catch (\Throwable $e) {
                    error_log('[GHPay] migration stmt error: ' . $e->getMessage() . ' | SQL: ' . substr($t, 0, 80));
                }
            }
        }
    }

    // ─── Settings ────────────────────────────────────────────────────────────

    private function loadSettings(): array {
        try {
            $stmt = $this->db->query("SELECT * FROM gh_pay_settings WHERE id = 1");
            return $stmt->fetch() ?: [];
        } catch (\Throwable $e) {
            // Table may not exist yet (before migration)
            return [];
        }
    }

    public function getSettings(): array {
        return $this->settings;
    }

    public function getPublicSettings(): array {
        $s = $this->settings;
        $isLive = $this->isLiveMode();
        $provider = $s['live_provider'] ?? 'none';
        $keyEnv = $s['provider_key_env'] ?? 'GH_LIVE_KEY_ID';
        $hasLiveKeys = !empty($keyEnv) && !empty(getenv($keyEnv));

        return [
            'success'               => true,
            'enabled'               => (int)($s['manual_verify_enabled'] ?? 1) === 1,
            'mode'                  => $s['mode'] ?? 'sandbox',
            'is_sandbox'            => !$isLive,
            'enabled_methods'       => $s['enabled_methods'] ?? 'qr_upi,cod,sandbox',
            'live_provider'         => $provider,
            'has_live_keys'         => $hasLiveKeys,
            'upi_id'                => $s['upi_id'] ?? '',
            'qr_image_path'         => $s['qr_image_path'] ?? '',
            'sandbox_auto_approve'  => (bool)($s['sandbox_auto_approve'] ?? 0)
        ];
    }

    public function isLiveMode(): bool {
        return ($this->settings['mode'] ?? 'sandbox') === 'live';
    }

    public function isSandboxMode(): bool {
        return !$this->isLiveMode();
    }

    public function isMethodEnabled(string $method): bool {
        $enabled = explode(',', $this->settings['enabled_methods'] ?? 'qr_upi,cod');
        return in_array(trim($method), $enabled, true);
    }

    // ─── Payment Initiation ──────────────────────────────────────────────────

    /**
     * Initiate a GreenHarvest Pay payment attempt for an existing order.
     *
     * @param int    $orderId         Existing order (already created)
     * @param int    $customerId      Authenticated customer ID
     * @param string $method          'qr_upi' | 'cod' | 'sandbox' | 'live_upi' | 'live_card'
     * @param string $idempotencyKey  Client-supplied unique key to prevent duplicates
     * @return array
     */
    public function initiatePayment(
        int    $orderId,
        int    $customerId,
        string $method,
        string $idempotencyKey,
        string $userRole = ''
    ): array {

        // --- Validate idempotency key (prevent double-submission) ---
        if (empty($idempotencyKey) || strlen($idempotencyKey) < 8) {
            return ['success' => false, 'error' => 'Invalid idempotency key.'];
        }

        // Check for existing attempt with this key
        $existing = $this->db->prepare(
            "SELECT * FROM gh_payment_attempts WHERE idempotency_key = ? LIMIT 1"
        );
        $existing->execute([$idempotencyKey]);
        $existingAttempt = $existing->fetch();

        if ($existingAttempt) {
            // Idempotent: return same result
            return [
                'success'      => true,
                'idempotent'   => true,
                'payment_ref'  => $existingAttempt['payment_ref'],
                'attempt_id'   => $existingAttempt['id'],
                'status'       => $existingAttempt['status'],
                'is_sandbox'   => (bool)$existingAttempt['is_sandbox']
            ];
        }

        // --- Validate order ownership and retrieve server-side amount ---
        $stmt = $this->db->prepare(
            "SELECT id, customer_id, total_amount, payment_status, order_status
             FROM orders WHERE id = ? FOR UPDATE"
        );
        $this->db->beginTransaction();
        try {
            $stmt->execute([$orderId]);
            $order = $stmt->fetch();

            if (!$order) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Order not found.'];
            }
            $isStaff = in_array($userRole, ['owner', 'shopkeeper'], true);
            if (!$isStaff && (int)$order['customer_id'] !== $customerId) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Unauthorized order access.'];
            }
            if (in_array($order['order_status'], ['Rejected', 'Cancelled'])) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Cannot pay for a cancelled or rejected order.'];
            }
            if ($order['payment_status'] === 'Paid') {
                $this->db->rollBack();
                // Return idempotent success if order is already marked Paid
                return [
                    'success'      => true,
                    'already_paid' => true,
                    'payment_ref'  => !empty($order['upi_trans_id']) ? $order['upi_trans_id'] : ('GHP-PAID-' . $orderId),
                    'status'       => 'paid',
                    'amount'       => (float)$order['total_amount']
                ];
            }

            // Check for non-terminal pending/processing attempt for this order
            $active = $this->db->prepare(
                "SELECT id, payment_ref, status FROM gh_payment_attempts
                 WHERE order_id = ? AND status IN ('initiated','pending','processing')
                 AND expires_at > NOW()
                 ORDER BY id DESC LIMIT 1"
            );
            $active->execute([$orderId]);
            $activeAttempt = $active->fetch();
            if ($activeAttempt) {
                $this->db->rollBack();
                // Return existing active attempt (prevent duplicate)
                return [
                    'success'     => true,
                    'idempotent'  => true,
                    'payment_ref' => $activeAttempt['payment_ref'],
                    'attempt_id'  => $activeAttempt['id'],
                    'status'      => $activeAttempt['status']
                ];
            }

            // --- Validate method ---
            if (!$this->isMethodEnabled($method) && !in_array($method, ['sandbox', 'cod'])) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Payment method not available.'];
            }

            // --- Generate unique payment reference ---
            $paymentRef = 'GHP-' . strtoupper(bin2hex(random_bytes(8)));

            // --- Insert attempt record ---
            $isSandbox = $this->isSandboxMode() ? 1 : 0;
            $ins = $this->db->prepare(
                "INSERT INTO gh_payment_attempts
                 (payment_ref, idempotency_key, order_id, customer_id, amount, method, status, is_sandbox)
                 VALUES (?, ?, ?, ?, ?, ?, 'initiated', ?)"
            );
            $ins->execute([
                $paymentRef,
                $idempotencyKey,
                $orderId,
                $customerId,
                $order['total_amount'],
                $method,
                $isSandbox
            ]);
            $attemptId = (int)$this->db->lastInsertId();

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            error_log('[GHPay] initiatePayment error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Payment initiation failed. Please try again.'];
        }

        // --- Provider-side initiation (outside transaction) ---
        $providerResult = ['success' => true];
        if ($method === 'sandbox') {
            $providerResult = $this->sandbox->initiatePayment([
                'payment_ref' => $paymentRef,
                'amount'      => (float)$order['total_amount'],
                'order_id'    => $orderId
            ]);
        } elseif ($this->isLiveMode() && str_starts_with($method, 'live_')) {
            $providerResult = $this->live->initiatePayment(
                (float)$order['total_amount'],
                $paymentRef
            );
        }

        // Update with provider order ID if available
        if (!empty($providerResult['provider_order_id'])) {
            $upd = $this->db->prepare(
                "UPDATE gh_payment_attempts
                 SET provider_name = ?, provider_order_id = ?, status = 'pending'
                 WHERE id = ?"
            );
            $upd->execute([
                $this->isLiveMode() ? $this->live->getProviderName() : 'sandbox',
                $providerResult['provider_order_id'],
                $attemptId
            ]);
        }

        $this->audit->log('payment_initiated', [
            'payment_ref' => $paymentRef,
            'order_id'    => $orderId,
            'method'      => $method,
            'amount'      => $order['total_amount'],
            'is_sandbox'  => $isSandbox
        ], $customerId, 'payment_attempt', $attemptId);

        return array_merge([
            'success'     => true,
            'payment_ref' => $paymentRef,
            'attempt_id'  => $attemptId,
            'amount'      => (float)$order['total_amount'],
            'is_sandbox'  => (bool)$isSandbox,
            'status'      => 'initiated'
        ], $providerResult);
    }

    // ─── Payment Verification ────────────────────────────────────────────────

    /**
     * Verify a payment attempt.
     * For sandbox: uses $outcome param.
     * For live: calls provider API to verify.
     * Updates both gh_payment_attempts and orders.payment_status atomically.
     *
     * @param int    $attemptId          gh_payment_attempts.id
     * @param int    $verifierUserId     Admin/owner performing verification
     * @param string $outcome            For sandbox/QR manual: 'paid'|'failed'|'pending'
     * @param string $providerPaymentId  Live provider payment ID (from webhook/client)
     * @param string $providerSignature  Live provider signature (from client)
     */
    public function verifyPayment(
        int    $attemptId,
        int    $verifierUserId,
        string $outcome             = 'paid',
        string $providerPaymentId   = '',
        string $providerSignature   = ''
    ): array {

        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                "SELECT * FROM gh_payment_attempts WHERE id = ? FOR UPDATE"
            );
            $stmt->execute([$attemptId]);
            $attempt = $stmt->fetch();

            if (!$attempt) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Payment attempt not found.'];
            }

            // Return idempotent success if attempt is already in the requested terminal state
            if ($attempt['status'] === $outcome || ($attempt['status'] === 'paid' && $outcome === 'paid')) {
                $this->db->rollBack();
                return [
                    'success'          => true,
                    'already_verified' => true,
                    'status'           => $attempt['status'],
                    'payment_ref'      => $attempt['payment_ref'],
                    'order_id'         => $attempt['order_id']
                ];
            }

            // Validate state transition
            if (!$this->canTransition($attempt['status'], $outcome === 'paid' ? 'paid' : ($outcome === 'failed' ? 'failed' : 'pending'))) {
                $this->db->rollBack();
                return [
                    'success' => false,
                    'error'   => "Invalid state transition: {$attempt['status']} → $outcome"
                ];
            }

            // Live mode: authoritative provider verification
            $verifiedStatus = $outcome;
            if ((bool)$attempt['is_sandbox'] === false && $this->isLiveMode()) {
                $liveResult = $this->live->verifyPayment(
                    $attempt['provider_order_id'],
                    $providerPaymentId ?: null,
                    $providerSignature ?: null
                );
                if (!$liveResult['success']) {
                    $this->db->rollBack();
                    return ['success' => false, 'error' => 'Provider verification failed: ' . ($liveResult['error'] ?? 'Unknown error')];
                }
                $verifiedStatus = $liveResult['verified_status'];
            }

            // Map verified_status to DB status
            $newStatus = match ($verifiedStatus) {
                'paid'      => 'paid',
                'failed'    => 'failed',
                'cancelled' => 'cancelled',
                default     => 'pending'
            };

            // Update payment attempt
            $upd = $this->db->prepare(
                "UPDATE gh_payment_attempts
                 SET status = ?,
                     provider_payment_id = COALESCE(?, provider_payment_id),
                     provider_signature  = COALESCE(?, provider_signature),
                     verified_at         = CASE WHEN ? = 'paid' THEN NOW() ELSE verified_at END,
                     verified_by_user_id = CASE WHEN ? = 'paid' THEN ? ELSE verified_by_user_id END
                 WHERE id = ?"
            );
            $upd->execute([
                $newStatus,
                $providerPaymentId ?: null,
                $providerSignature  ?: null,
                $newStatus, $newStatus, $verifierUserId,
                $attemptId
            ]);

            // Update orders.payment_status (map to existing CHECK values)
            $orderPaymentStatus = match ($newStatus) {
                'paid'     => 'Paid',
                'failed'   => 'Failed',
                'refunded' => 'Refunded',
                default    => 'Pending'
            };

            $updOrder = $this->db->prepare(
                "UPDATE orders SET payment_status = ?, upi_trans_id = COALESCE(NULLIF(upi_trans_id, ''), ?) WHERE id = ?"
            );
            $updOrder->execute([$orderPaymentStatus, $attempt['payment_ref'], $attempt['order_id']]);

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            error_log('[GHPay] verifyPayment error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Verification failed. Please try again.'];
        }

        $this->audit->log('payment_verified', [
            'attempt_id'    => $attemptId,
            'new_status'    => $newStatus,
            'order_id'      => $attempt['order_id'],
            'is_sandbox'    => $attempt['is_sandbox']
        ], $verifierUserId, 'payment_attempt', $attemptId);

        return [
            'success'    => true,
            'new_status' => $newStatus,
            'order_id'   => $attempt['order_id'],
            'payment_ref'=> $attempt['payment_ref']
        ];
    }

    // ─── QR Submission (Customer) ────────────────────────────────────────────

    /**
     * Customer submits UTR + screenshot for QR/UPI manual verification.
     */
    public function submitQrPayment(
        int     $attemptId,
        int     $customerId,
        string  $utrReference,
        ?string $screenshotPath
    ): array {

        // Validate attempt belongs to customer
        $stmt = $this->db->prepare(
            "SELECT * FROM gh_payment_attempts WHERE id = ? AND customer_id = ?"
        );
        $stmt->execute([$attemptId, $customerId]);
        $attempt = $stmt->fetch();

        if (!$attempt) {
            return ['success' => false, 'error' => 'Payment attempt not found or unauthorized.'];
        }

        if (!in_array($attempt['status'], ['initiated', 'pending'])) {
            return ['success' => false, 'error' => 'Payment cannot accept QR submission in current state.'];
        }

        // Sanitise UTR reference
        $utrRef = preg_replace('/[^A-Za-z0-9\-]/', '', $utrReference);
        if (strlen($utrRef) < 6 || strlen($utrRef) > 50) {
            return ['success' => false, 'error' => 'Invalid UTR reference. Please enter a valid 6-50 character reference.'];
        }

        // Duplicate UTR detection across all orders (prevent replay)
        $dupCheck = $this->db->prepare(
            "SELECT id FROM gh_qr_submissions WHERE utr_reference = ? AND verification_status != 'rejected'"
        );
        $dupCheck->execute([$utrRef]);
        if ($dupCheck->fetch()) {
            return ['success' => false, 'error' => 'This UTR reference has already been submitted. Please check your transaction history.'];
        }

        $this->db->beginTransaction();
        try {
            $ins = $this->db->prepare(
                "INSERT INTO gh_qr_submissions
                 (payment_attempt_id, order_id, customer_id, utr_reference, screenshot_path, verification_status)
                 VALUES (?, ?, ?, ?, ?, 'pending')"
            );
            $ins->execute([
                $attemptId,
                $attempt['order_id'],
                $customerId,
                $utrRef,
                $screenshotPath
            ]);
            $submissionId = (int)$this->db->lastInsertId();

            // Move attempt to pending
            $upd = $this->db->prepare(
                "UPDATE gh_payment_attempts SET status = 'pending' WHERE id = ? AND status = 'initiated'"
            );
            $upd->execute([$attemptId]);

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            error_log('[GHPay] submitQrPayment error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Submission failed. Please try again.'];
        }

        $this->audit->log('qr_payment_submitted', [
            'attempt_id'    => $attemptId,
            'order_id'      => $attempt['order_id'],
            'utr_reference' => $utrRef
        ], $customerId, 'qr_submission', $submissionId);

        return [
            'success'       => true,
            'submission_id' => $submissionId,
            'message'       => 'Payment details submitted. The owner/admin will verify within a few minutes.'
        ];
    }

    /**
     * Owner approves or rejects a QR payment submission.
     */
    public function verifyQrSubmission(
        int    $submissionId,
        int    $ownerUserId,
        string $decision,   // 'approved' | 'rejected'
        string $reason = ''
    ): array {

        if (!in_array($decision, ['approved', 'rejected'])) {
            return ['success' => false, 'error' => 'Decision must be approved or rejected.'];
        }

        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                "SELECT s.*, a.order_id, a.customer_id
                 FROM gh_qr_submissions s
                 JOIN gh_payment_attempts a ON s.payment_attempt_id = a.id
                 WHERE s.id = ?
                 FOR UPDATE"
            );
            $stmt->execute([$submissionId]);
            $sub = $stmt->fetch();

            if (!$sub) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'QR submission not found.'];
            }

            if ($sub['verification_status'] !== 'pending') {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'This submission has already been ' . $sub['verification_status'] . '.'];
            }

            // Update QR submission record
            $upd = $this->db->prepare(
                "UPDATE gh_qr_submissions
                 SET verification_status = ?, verified_by_user_id = ?, verified_at = NOW(),
                     rejection_reason = ?
                 WHERE id = ?"
            );
            $upd->execute([$decision, $ownerUserId, $reason ?: null, $submissionId]);

            // Update payment attempt and order
            $payStatus = ($decision === 'approved') ? 'paid' : 'failed';
            $orderPayStatus = ($decision === 'approved') ? 'Paid' : 'Failed';

            $updAttempt = $this->db->prepare(
                "UPDATE gh_payment_attempts
                 SET status = ?, verified_at = NOW(), verified_by_user_id = ?
                 WHERE id = ?"
            );
            $updAttempt->execute([$payStatus, $ownerUserId, $sub['payment_attempt_id']]);

            $updOrder = $this->db->prepare(
                "UPDATE orders SET payment_status = ? WHERE id = ?"
            );
            $updOrder->execute([$orderPayStatus, $sub['order_id']]);

            // Notify customer
            $title = ($decision === 'approved')
                ? '✅ Payment Verified'
                : '❌ Payment Verification Failed';
            $msg = ($decision === 'approved')
                ? 'Your UPI payment has been verified and confirmed!'
                : 'Your UPI payment could not be verified. Reason: ' . ($reason ?: 'Not provided');

            $notif = $this->db->prepare(
                "INSERT INTO notifications (user_id, for_role, title, message, type, link)
                 VALUES (?, 'customer', ?, ?, 'payment', '#payments')"
            );
            $notif->execute([$sub['customer_id'], $title, $msg]);

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            error_log('[GHPay] verifyQrSubmission error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Verification failed. Please try again.'];
        }

        $this->audit->log('qr_submission_verified', [
            'submission_id' => $submissionId,
            'decision'      => $decision,
            'reason'        => $reason
        ], $ownerUserId, 'qr_submission', $submissionId);

        return ['success' => true, 'decision' => $decision];
    }

    // ─── Refund ──────────────────────────────────────────────────────────────

    public function refundPayment(int $attemptId, int $ownerUserId, string $reason = ''): array {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                "SELECT * FROM gh_payment_attempts WHERE id = ? FOR UPDATE"
            );
            $stmt->execute([$attemptId]);
            $attempt = $stmt->fetch();

            if (!$attempt) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Payment attempt not found.'];
            }

            if ($attempt['status'] !== 'paid') {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Only paid payments can be refunded.'];
            }

            // Issue refund via adapter
            $refundResult = ['success' => true, 'refund_id' => 'MANUAL-' . time()];
            if ((bool)$attempt['is_sandbox']) {
                $refundResult = $this->sandbox->refundPayment(
                    $attempt['provider_payment_id'] ?? '',
                    (float)$attempt['amount']
                );
            } elseif ($this->isLiveMode() && $attempt['provider_payment_id']) {
                $refundResult = $this->live->refundPayment(
                    $attempt['provider_payment_id'],
                    (float)$attempt['amount'],
                    $reason
                );
            }

            if (!$refundResult['success']) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Refund failed: ' . ($refundResult['error'] ?? 'Unknown error')];
            }

            // Update attempt status
            $upd = $this->db->prepare(
                "UPDATE gh_payment_attempts SET status = 'refunded', verified_by_user_id = ? WHERE id = ?"
            );
            $upd->execute([$ownerUserId, $attemptId]);

            // Update order payment status
            $updOrder = $this->db->prepare(
                "UPDATE orders SET payment_status = 'Refunded' WHERE id = ?"
            );
            $updOrder->execute([$attempt['order_id']]);

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            error_log('[GHPay] refundPayment error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Refund failed. Please try again.'];
        }

        $this->audit->log('payment_refunded', [
            'attempt_id' => $attemptId,
            'order_id'   => $attempt['order_id'],
            'amount'     => $attempt['amount'],
            'reason'     => $reason
        ], $ownerUserId, 'payment_attempt', $attemptId);

        return ['success' => true, 'refund_id' => $refundResult['refund_id'] ?? null];
    }

    // ─── State Machine Helper ────────────────────────────────────────────────

    private function canTransition(string $fromStatus, string $toStatus): bool {
        return in_array($toStatus, self::TRANSITIONS[$fromStatus] ?? [], true);
    }

    // ─── Reconciliation & Reports ────────────────────────────────────────────

    public function getDashboardStats(): array {
        $isSandbox = $this->isSandboxMode() ? 1 : 0;
        $today = date('Y-m-d');

        // Payment attempt counts by status
        $counts = $this->db->prepare(
            "SELECT status, COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
             FROM gh_payment_attempts
             WHERE is_sandbox = ?
             GROUP BY status"
        );
        $counts->execute([$isSandbox]);
        $byStatus = [];
        foreach ($counts->fetchAll() as $row) {
            $byStatus[$row['status']] = [
                'count' => (int)$row['cnt'],
                'total' => (float)$row['total']
            ];
        }

        // Today's paid
        $todayPaid = $this->db->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM gh_payment_attempts
             WHERE status = 'paid' AND is_sandbox = ? AND DATE(verified_at) = ?"
        );
        $todayPaid->execute([$isSandbox, $today]);

        // Pending QR verifications
        $pendingQr = $this->db->query(
            "SELECT COUNT(*) FROM gh_qr_submissions WHERE verification_status = 'pending'"
        )->fetchColumn();

        return [
            'mode'            => $this->isSandboxMode() ? 'sandbox' : 'live',
            'by_status'       => $byStatus,
            'today_paid'      => (float)$todayPaid->fetchColumn(),
            'pending_qr_queue'=> (int)$pendingQr,
            'live_provider'   => $this->settings['live_provider'] ?? 'none',
            'live_configured' => $this->isLiveMode() ? $this->live->isConfigured() : false,
        ];
    }

    public function getTransactionList(array $filters = [], int $limit = 50, int $offset = 0): array {
        $where = [];
        $params = [];

        if (isset($filters['status']) && $filters['status'] !== 'all') {
            $where[] = 'a.status = ?';
            $params[] = $filters['status'];
        }
        if (isset($filters['method']) && $filters['method'] !== 'all') {
            $where[] = 'a.method = ?';
            $params[] = $filters['method'];
        }
        if (!empty($filters['search'])) {
            $s = '%' . $filters['search'] . '%';
            $where[] = '(a.payment_ref LIKE ? OR a.provider_payment_id LIKE ? OR a.provider_order_id LIKE ?)';
            $params = array_merge($params, [$s, $s, $s]);
        }
        if (!empty($filters['date_from'])) {
            $where[] = 'DATE(a.created_at) >= ?';
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $where[] = 'DATE(a.created_at) <= ?';
            $params[] = $filters['date_to'];
        }
        if (isset($filters['is_sandbox'])) {
            $where[] = 'a.is_sandbox = ?';
            $params[] = (int)$filters['is_sandbox'];
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $sql = "SELECT a.*, o.order_number, u.name as customer_name, u.phone as customer_phone
                FROM gh_payment_attempts a
                JOIN orders o ON a.order_id = o.id
                JOIN users u ON a.customer_id = u.id
                $whereClause
                ORDER BY a.id DESC
                LIMIT ? OFFSET ?";

        $stmt = $this->db->prepare($sql);
        $allParams = array_merge($params, [$limit, $offset]);
        $stmt->execute($allParams);

        return $stmt->fetchAll();
    }

    public function getPendingQrSubmissions(): array {
        $stmt = $this->db->query(
            "SELECT s.*, a.payment_ref, a.amount, a.method,
                    o.order_number, u.name as customer_name, u.phone as customer_phone
             FROM gh_qr_submissions s
             JOIN gh_payment_attempts a ON s.payment_attempt_id = a.id
             JOIN orders o ON s.order_id = o.id
             JOIN users u ON s.customer_id = u.id
             WHERE s.verification_status = 'pending'
             ORDER BY s.created_at ASC"
        );
        return $stmt->fetchAll();
    }

    /**
     * Expire timed-out payment attempts (run periodically / on dashboard load).
     */
    public function expireOldAttempts(): int {
        $stmt = $this->db->prepare(
            "UPDATE gh_payment_attempts
             SET status = 'expired'
             WHERE status IN ('initiated', 'pending')
             AND expires_at < NOW()"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }
}
