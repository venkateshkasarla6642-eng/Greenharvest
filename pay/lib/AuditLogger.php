<?php
// pay/lib/AuditLogger.php — GreenHarvest Pay Audit Logger
// Logs all sensitive payment actions. Never logs secrets, passwords, or card data.

class AuditLogger {

    private PDO $db;

    public function __construct(PDO $db) {
        $this->db = $db;
    }

    /**
     * Log a payment-related action.
     *
     * @param string   $action      e.g. 'payment_initiated', 'payment_verified', 'refund_requested'
     * @param array    $meta        Non-sensitive metadata (order_id, amount, method…)
     * @param int|null $userId      Authenticated user performing the action
     * @param string   $entityType  'payment_attempt' | 'order' | 'qr_submission' | 'settings'
     * @param int|null $entityId    ID of the entity
     */
    public function log(
        string $action,
        array  $meta        = [],
        ?int   $userId      = null,
        string $entityType  = '',
        ?int   $entityId    = null
    ): void {
        try {
            // Scrub any accidental secrets from meta
            $safe = $this->scrubMeta($meta);

            $stmt = $this->db->prepare(
                "INSERT INTO gh_audit_log
                 (user_id, user_role, action, entity_type, entity_id, meta, ip_address, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $userId,
                $safe['_role'] ?? null,
                $action,
                $entityType ?: null,
                $entityId,
                json_encode(array_filter($safe, fn($k) => $k !== '_role', ARRAY_FILTER_USE_KEY)),
                $this->getClientIp(),
                substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 500)
            ]);
        } catch (\Throwable $e) {
            // Audit log failure must NEVER break the payment flow
            error_log('[GHPay][Audit] Failed to write audit log: ' . $e->getMessage());
        }
    }

    /**
     * Remove keys that could contain secrets or PII.
     */
    private function scrubMeta(array $meta): array {
        $blocklist = [
            'password', 'secret', 'key', 'token', 'pin', 'otp',
            'card', 'cvv', 'signature', 'webhook_secret', 'api_secret',
            'provider_secret', 'raw_body'
        ];

        foreach ($meta as $k => $v) {
            foreach ($blocklist as $bad) {
                if (stripos($k, $bad) !== false) {
                    $meta[$k] = '[REDACTED]';
                    break;
                }
            }
        }
        return $meta;
    }

    private function getClientIp(): string {
        $candidates = [
            'HTTP_CF_CONNECTING_IP',
            'HTTP_X_REAL_IP',
            'HTTP_X_FORWARDED_FOR',
            'REMOTE_ADDR'
        ];
        foreach ($candidates as $key) {
            if (!empty($_SERVER[$key])) {
                $ip = trim(explode(',', $_SERVER[$key])[0]);
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }
        return 'unknown';
    }
}
