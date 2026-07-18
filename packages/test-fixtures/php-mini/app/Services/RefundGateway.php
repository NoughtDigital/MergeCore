<?php

namespace App\Services;

use App\Contracts\Refundable;
use App\Models\Order;

/**
 * Uses the Laravel container at runtime — not compiler-certain.
 */
class RefundGateway implements Refundable
{
    public function refund(Order $order): void
    {
        $notifier = app('App\\Listeners\\SendRefundNotification');
        resolve('App\\Jobs\\ProcessRefund');
        $order->markRefunded();
    }
}
