<?php

namespace App\Listeners;

use App\Events\OrderRefunded;

class SendRefundNotification
{
    public function handle(OrderRefunded $event): void
    {
        // notify customer
    }
}
