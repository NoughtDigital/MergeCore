<?php

namespace App\Events;

use App\Models\Order;

class OrderRefunded
{
    public function __construct(public Order $order)
    {
    }
}
