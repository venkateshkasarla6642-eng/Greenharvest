<?php
// pay/lib/LiveAdapter.php — GreenHarvest Pay Live Provider Adapter
// Modular stub for connecting a real payment provider (Razorpay, Cashfree, PhonePe, etc.)
//
// HOW TO ACTIVATE:
// 1. Set GH_PAY_MODE=live in your Render environment variables.
// 2. Set GH_LIVE_PROVIDER=razorpay (or cashfree, phonepe).
// 3. Set GH_LIVE_KEY_ID and GH_LIVE_KEY_SECRET as Render env vars.
// 4. Set GH_WEBHOOK_SECRET as a Render env var (from provider dashboard).
// 5. Implement the provider-specific methods below for your chosen provider.
// 6. NEVER commit actual credentials to this file or git history.
//
// LEGAL REQUIREMENT: You must have a valid merchant account with the chosen
// provider and comply with RBI regulations and the provider's terms of service
// before enabling live payments.

class LiveAdapter {

    private string $provider;
    private string $keyId;
    private string $keySecret;
    private string $webhookSecret;
    private array  $settings;

    public function __construct(array $settings = []) {
        $this->settings = $settings;
        $this->resolveCredentials();
    }

    /**
     * Unified environment variable reader: checks getenv(), $_ENV, $_SERVER, and /proc/1/environ (for Docker containers on Render).
     */
    private function getEnvVal(string $key): ?string {
        if (getenv($key) !== false && getenv($key) !== '') {
            return (string)getenv($key);
        }
        if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
            return (string)$_ENV[$key];
        }
        if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
            return (string)$_SERVER[$key];
        }
        static $procEnv = null;
        if ($procEnv === null) {
            $procEnv = [];
            if (@is_readable('/proc/1/environ')) {
                $content = @file_get_contents('/proc/1/environ');
                if ($content !== false) {
                    $entries = explode("\0", $content);
                    foreach ($entries as $entry) {
                        $parts = explode('=', $entry, 2);
                        if (count($parts) === 2) {
                            $procEnv[$parts[0]] = $parts[1];
                        }
                    }
                }
            }
        }
        if (isset($procEnv[$key]) && $procEnv[$key] !== '') {
            return (string)$procEnv[$key];
        }
        return null;
    }

    /**
     * Smart credentials resolver:
     * Supports BOTH direct API keys entered in admin settings AND Render environment variable names.
     */
    private function resolveCredentials(): void {
        // 1. Resolve Key ID
        $rawKey = trim($this->settings['provider_key_env'] ?? '');
        $resolvedKey = '';
        if (!empty($rawKey)) {
            $val = $this->getEnvVal($rawKey);
            if (!empty($val)) {
                $resolvedKey = $val;
            } else {
                $resolvedKey = $rawKey; // Direct key string (e.g. rzp_test_... or rzp_live_...)
            }
        }
        if (empty($resolvedKey)) {
            $candidates = [
                'GH_LIVE_KEY_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY',
                'RAZORPAY_API_KEY', 'RZP_KEY_ID', 'RZP_TEST_KEY_ID',
                'RZP_KEY', 'KEY_ID', 'API_KEY'
            ];
            foreach ($candidates as $cand) {
                $v = $this->getEnvVal($cand);
                if (!empty($v) && ($cand !== 'API_KEY' || str_starts_with($v, 'rzp_'))) {
                    $resolvedKey = trim($v);
                    break;
                }
            }
        }
        $this->keyId = $resolvedKey;

        // 2. Resolve Key Secret
        $rawSecret = trim($this->settings['provider_secret_env'] ?? '');
        $resolvedSecret = '';
        if (!empty($rawSecret) && !str_contains($rawSecret, '•••')) {
            $val = $this->getEnvVal($rawSecret);
            if (!empty($val)) {
                $resolvedSecret = $val;
            } else {
                $resolvedSecret = $rawSecret;
            }
        }
        if (empty($resolvedSecret)) {
            $candidates = [
                'GH_LIVE_KEY_SECRET', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_SECRET',
                'RAZORPAY_SECRET_KEY', 'RAZORPAY_API_SECRET', 'RZP_KEY_SECRET',
                'RZP_TEST_KEY_SECRET', 'RZP_SECRET', 'KEY_SECRET', 'API_SECRET',
                'SECRET_KEY'
            ];
            foreach ($candidates as $cand) {
                $v = $this->getEnvVal($cand);
                if (!empty($v)) {
                    $resolvedSecret = trim($v);
                    break;
                }
            }
        }
        $this->keySecret = $resolvedSecret;

        // 3. Resolve Webhook Secret
        $rawWebhook = trim($this->settings['webhook_secret_env'] ?? '');
        $resolvedWebhook = '';
        if (!empty($rawWebhook)) {
            $val = $this->getEnvVal($rawWebhook);
            if (!empty($val)) {
                $resolvedWebhook = $val;
            } else {
                $resolvedWebhook = $rawWebhook;
            }
        }
        if (empty($resolvedWebhook)) {
            $candidates = [
                'GH_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'WEBHOOK_SECRET'
            ];
            foreach ($candidates as $cand) {
                $v = $this->getEnvVal($cand);
                if (!empty($v)) {
                    $resolvedWebhook = trim($v);
                    break;
                }
            }
        }
        $this->webhookSecret = $resolvedWebhook;

        // 4. Resolve Provider Name
        $prov = trim($this->settings['live_provider'] ?? '');
        if (empty($prov) || $prov === 'none') {
            $prov = $this->getEnvVal('GH_LIVE_PROVIDER') ?: '';
        }
        if (empty($prov) || $prov === 'none') {
            if (str_starts_with($this->keyId, 'rzp_')) {
                $prov = 'razorpay';
            } else {
                $prov = 'none';
            }
        }
        $this->provider = strtolower($prov);
    }

    /** Check if live provider is properly configured (requires provider, keyId, keySecret). */
    public function isConfigured(): bool {
        if (!empty($this->keyId) && str_starts_with($this->keyId, 'rzp_')) {
            $this->provider = 'razorpay';
        }
        return $this->provider !== 'none'
            && !empty($this->keyId)
            && !empty($this->keySecret);
    }

    public function getProviderName(): string {
        return $this->provider;
    }

    public function getKeyId(): string {
        return $this->keyId;
    }

    public function getKeySecret(): string {
        return $this->keySecret;
    }

    public function getWebhookSecret(): string {
        return $this->webhookSecret;
    }

    public function isTestMode(): bool {
        return str_starts_with($this->keyId, 'rzp_test_');
    }

    /**
     * Test API connection with the configured provider credentials.
     */
    public function testConnection(): array {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'error'   => 'Credentials not configured. Please enter your Razorpay Key ID and Key Secret.'
            ];
        }

        if ($this->provider === 'razorpay') {
            $res = $this->curlGet('https://api.razorpay.com/v1/orders?count=1', $this->keyId, $this->keySecret);
            if ($res['success']) {
                $isTest = $this->isTestMode();
                return [
                    'success'  => true,
                    'provider' => 'razorpay',
                    'is_test'  => $isTest,
                    'key_id'   => $this->keyId,
                    'message'  => 'Successfully connected to Razorpay API! ' . ($isTest ? '🧪 Test Mode (rzp_test) is active.' : '🟢 Live Production mode is active.')
                ];
            }
            $errData = json_decode($res['body'] ?? '', true);
            $errMsg = $errData['error']['description'] ?? ($res['error'] ?? 'Authentication failed.');
            return [
                'success' => false,
                'error'   => 'Razorpay connection test failed: ' . $errMsg
            ];
        }

        return ['success' => true, 'message' => 'Provider configured.'];
    }

    /**
     * Create a payment order on the provider side.
     * Returns provider order_id and checkout URL/key.
     *
     * @param float  $amount     Amount in INR (will be converted to paise for Razorpay)
     * @param string $paymentRef Internal GreenHarvest Pay reference
     * @param string $currency   'INR'
     * @param array  $options    Extra options (customer email, phone, etc.)
     */
    public function initiatePayment(float $amount, string $paymentRef, string $currency = 'INR', array $options = []): array {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Live payment provider not configured.'];
        }

        switch ($this->provider) {
            case 'razorpay':
                return $this->razorpayCreateOrder($amount, $paymentRef, $currency, $options);
            case 'cashfree':
                return $this->cashfreeCreateOrder($amount, $paymentRef, $currency, $options);
            default:
                return ['success' => false, 'error' => 'Unsupported provider: ' . $this->provider];
        }
    }

    /**
     * Verify a payment using authoritative server-side API call.
     * Never trust client-supplied signatures alone — always cross-check with provider API.
     */
    public function verifyPayment(string $providerOrderId, ?string $providerPaymentId = null, ?string $signature = null): array {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Live payment provider not configured.'];
        }

        switch ($this->provider) {
            case 'razorpay':
                return $this->razorpayVerify($providerOrderId, $providerPaymentId, $signature);
            case 'cashfree':
                return $this->cashfreeVerify($providerOrderId);
            default:
                return ['success' => false, 'error' => 'Unsupported provider: ' . $this->provider];
        }
    }

    /**
     * Verify a webhook signature.
     * Returns ['valid' => bool, 'event_type' => string, ...]
     */
    public function verifyWebhook(string $rawBody, string $signatureHeader): array {
        if (empty($this->webhookSecret)) {
            return ['valid' => false, 'error' => 'Webhook secret not configured.'];
        }

        switch ($this->provider) {
            case 'razorpay':
                return $this->razorpayVerifyWebhook($rawBody, $signatureHeader);
            case 'cashfree':
                return $this->cashfreeVerifyWebhook($rawBody, $signatureHeader);
            default:
                return ['valid' => false, 'error' => 'Unsupported provider.'];
        }
    }

    /**
     * Issue a refund via provider API.
     */
    public function refundPayment(string $providerPaymentId, float $amount, string $reason = ''): array {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Live payment provider not configured.'];
        }

        switch ($this->provider) {
            case 'razorpay':
                return $this->razorpayRefund($providerPaymentId, $amount, $reason);
            default:
                return ['success' => false, 'error' => 'Refunds not implemented for: ' . $this->provider];
        }
    }

    // ─── Razorpay Implementation ─────────────────────────────────────────────

    private function razorpayCreateOrder(float $amount, string $ref, string $currency, array $opts): array {
        $amountPaise = (int) round($amount * 100);
        $payload = json_encode([
            'amount'   => $amountPaise,
            'currency' => $currency,
            'receipt'  => $ref,
            'notes'    => ['payment_ref' => $ref]
        ]);

        $response = $this->curlPost(
            'https://api.razorpay.com/v1/orders',
            $payload,
            ['Content-Type: application/json'],
            $this->keyId,
            $this->keySecret
        );

        if (!$response['success']) {
            return ['success' => false, 'error' => 'Razorpay order creation failed: ' . $response['error']];
        }

        $data = json_decode($response['body'], true);
        if (empty($data['id'])) {
            return ['success' => false, 'error' => 'Razorpay returned no order ID.'];
        }

        return [
            'success'           => true,
            'provider_order_id' => $data['id'],
            'key_id'            => $this->keyId, // Sent to frontend for Razorpay checkout.js
            'amount_paise'      => $amountPaise,
            'currency'          => $currency,
            'provider'          => 'razorpay'
        ];
    }

    private function razorpayVerify(string $orderId, ?string $paymentId, ?string $signature): array {
        // Step 1: Verify HMAC signature (if provided)
        if ($paymentId && $signature) {
            $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $this->keySecret);
            if (!hash_equals($expected, $signature)) {
                return ['success' => false, 'verified_status' => 'failed', 'error' => 'Signature mismatch.'];
            }
        }

        // Step 2: Cross-verify with Razorpay API (authoritative)
        if ($paymentId) {
            $response = $this->curlGet(
                'https://api.razorpay.com/v1/payments/' . urlencode($paymentId),
                $this->keyId,
                $this->keySecret
            );
            if ($response['success']) {
                $data = json_decode($response['body'], true);
                $status = match ($data['status'] ?? 'failed') {
                    'captured' => 'paid',
                    'authorized' => 'pending',
                    'failed'  => 'failed',
                    default   => 'failed'
                };
                return [
                    'success'             => true,
                    'verified_status'     => $status,
                    'provider_payment_id' => $paymentId,
                    'provider_order_id'   => $orderId,
                    'amount'              => isset($data['amount']) ? $data['amount'] / 100 : null,
                    'currency'            => $data['currency'] ?? 'INR',
                    'is_sandbox'          => false
                ];
            }
        }

        return ['success' => false, 'verified_status' => 'failed', 'error' => 'Could not verify with provider.'];
    }

    private function razorpayVerifyWebhook(string $rawBody, string $signature): array {
        $expected = hash_hmac('sha256', $rawBody, $this->webhookSecret);
        if (!hash_equals($expected, $signature)) {
            return ['valid' => false, 'error' => 'Invalid webhook signature.'];
        }

        $data = json_decode($rawBody, true);
        $event = $data['event'] ?? '';
        $paymentEntity = $data['payload']['payment']['entity'] ?? [];
        $orderEntity   = $data['payload']['order']['entity']   ?? [];

        $status = match ($event) {
            'payment.captured'  => 'paid',
            'payment.failed'    => 'failed',
            'order.paid'        => 'paid',
            'refund.created'    => 'refunded',
            default             => 'unknown'
        };

        return [
            'valid'               => true,
            'is_sandbox'          => false,
            'event_type'          => $event,
            'provider_order_id'   => $orderEntity['id']   ?? $paymentEntity['order_id'] ?? null,
            'provider_payment_id' => $paymentEntity['id'] ?? null,
            'status'              => $status,
            'amount'              => isset($paymentEntity['amount']) ? $paymentEntity['amount'] / 100 : null,
            'currency'            => $paymentEntity['currency'] ?? 'INR'
        ];
    }

    private function razorpayRefund(string $paymentId, float $amount, string $reason): array {
        $payload = json_encode([
            'amount' => (int) round($amount * 100),
            'notes'  => ['reason' => $reason]
        ]);
        $response = $this->curlPost(
            'https://api.razorpay.com/v1/payments/' . urlencode($paymentId) . '/refund',
            $payload,
            ['Content-Type: application/json'],
            $this->keyId,
            $this->keySecret
        );

        if (!$response['success']) {
            return ['success' => false, 'error' => 'Razorpay refund failed: ' . $response['error']];
        }

        $data = json_decode($response['body'], true);
        return [
            'success'   => true,
            'refund_id' => $data['id'] ?? null,
            'amount'    => $amount,
            'status'    => $data['status'] ?? 'processed'
        ];
    }

    // ─── Cashfree Stub ───────────────────────────────────────────────────────

    private function cashfreeCreateOrder(float $amount, string $ref, string $currency, array $opts): array {
        // TODO: Implement Cashfree order creation when Cashfree is selected provider
        return ['success' => false, 'error' => 'Cashfree adapter: implementation pending. Set GH_LIVE_PROVIDER=razorpay to use Razorpay.'];
    }

    private function cashfreeVerify(string $orderId): array {
        return ['success' => false, 'error' => 'Cashfree verification: implementation pending.'];
    }

    private function cashfreeVerifyWebhook(string $rawBody, string $sig): array {
        return ['valid' => false, 'error' => 'Cashfree webhook: implementation pending.'];
    }

    // ─── cURL Helpers ────────────────────────────────────────────────────────

    private function curlPost(string $url, string $payload, array $headers, string $user = '', string $pass = ''): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($user) curl_setopt($ch, CURLOPT_USERPWD, "$user:$pass");
        $body  = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno || $body === false) {
            return ['success' => false, 'error' => "cURL error $errno: $error"];
        }
        if ($httpCode >= 400) {
            return ['success' => false, 'error' => "HTTP $httpCode", 'body' => $body];
        }
        return ['success' => true, 'body' => $body, 'http_code' => $httpCode];
    }

    private function curlGet(string $url, string $user = '', string $pass = ''): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($user) curl_setopt($ch, CURLOPT_USERPWD, "$user:$pass");
        $body  = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno || $body === false) {
            return ['success' => false, 'error' => "cURL error $errno: $error"];
        }
        if ($httpCode >= 400) {
            return ['success' => false, 'error' => "HTTP $httpCode", 'body' => $body];
        }
        return ['success' => true, 'body' => $body, 'http_code' => $httpCode];
    }
}
