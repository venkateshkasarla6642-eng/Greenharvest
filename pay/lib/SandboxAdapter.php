<?php
// pay/lib/SandboxAdapter.php — GreenHarvest Pay Sandbox Payment Provider
// Simulates all payment states without moving real money.
// Every sandbox transaction is clearly flagged; never counted in live totals.

class SandboxAdapter {

    /** Simulate initiating a payment. Returns a fake provider order_id. */
    public function initiatePayment(array $attempt): array {
        $simulatedOrderId = 'SANDBOX_ORD_' . strtoupper(bin2hex(random_bytes(6)));
        return [
            'success'          => true,
            'provider_order_id'=> $simulatedOrderId,
            'payment_url'      => null, // No redirect for sandbox; handled in-page
            'meta'             => [
                'sandbox'  => true,
                'message'  => 'Sandbox payment initiated. Use the test panel to simulate outcomes.'
            ]
        ];
    }

    /**
     * Simulate verifying a payment.
     * $outcome: 'paid' | 'failed' | 'pending' | 'cancelled'
     */
    public function verifyPayment(string $providerOrderId, string $outcome = 'paid'): array {
        $allowed = ['paid', 'failed', 'pending', 'cancelled'];
        if (!in_array($outcome, $allowed)) {
            $outcome = 'paid';
        }

        return [
            'success'            => true,
            'verified_status'    => $outcome,
            'provider_payment_id'=> 'SANDBOX_PAY_' . strtoupper(bin2hex(random_bytes(6))),
            'provider_order_id'  => $providerOrderId,
            'amount'             => null, // Not relevant for sandbox
            'currency'           => 'INR',
            'is_sandbox'         => true,
            'meta'               => [
                'sandbox'  => true,
                'simulated'=> true,
                'outcome'  => $outcome
            ]
        ];
    }

    /** Simulate a refund. */
    public function refundPayment(string $providerPaymentId, float $amount): array {
        return [
            'success'          => true,
            'refund_id'        => 'SANDBOX_REF_' . strtoupper(bin2hex(random_bytes(6))),
            'amount'           => $amount,
            'status'           => 'processed',
            'is_sandbox'       => true
        ];
    }

    /** Parse a simulated webhook event body. */
    public function parseWebhookEvent(string $rawBody, string $signature): array {
        // In sandbox mode, accept any well-formed JSON payload
        $data = json_decode($rawBody, true);
        if (!is_array($data)) {
            return ['valid' => false, 'error' => 'Invalid JSON'];
        }
        return [
            'valid'           => true,
            'is_sandbox'      => true,
            'event_type'      => $data['event'] ?? 'payment.captured',
            'provider_order_id'=> $data['order_id'] ?? null,
            'provider_payment_id'=> $data['payment_id'] ?? null,
            'status'          => $data['status'] ?? 'paid',
            'amount'          => isset($data['amount']) ? (int)$data['amount'] : null,
            'currency'        => $data['currency'] ?? 'INR'
        ];
    }
}
