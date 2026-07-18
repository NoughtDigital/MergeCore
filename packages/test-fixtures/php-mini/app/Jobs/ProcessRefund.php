<?php

namespace App\Jobs;

use App\Contracts\Refundable;
use App\Events\OrderRefunded;
use App\Models\Order;
use Illuminate\Contracts\Queue\ShouldQueue;

class ProcessRefund implements ShouldQueue, Refundable
{
    public function __construct(public Order $order)
    {
    }

    public function handle(): void
    {
        $this->refund($this->order);
    }

    public function refund(Order $order): void
    {
        $order->markRefunded();
        event(new OrderRefunded($order));
    }
}
