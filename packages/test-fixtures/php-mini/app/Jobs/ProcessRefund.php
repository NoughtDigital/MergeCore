<?php

namespace App\Jobs;

use App\Events\OrderRefunded;
use App\Models\Order;
use Illuminate\Contracts\Queue\ShouldQueue;

class ProcessRefund implements ShouldQueue
{
    public function __construct(public Order $order)
    {
    }

    public function handle(): void
    {
        $this->order->markRefunded();
        event(new OrderRefunded($this->order));
    }
}
