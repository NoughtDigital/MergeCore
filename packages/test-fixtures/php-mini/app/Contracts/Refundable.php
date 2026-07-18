<?php

namespace App\Contracts;

use App\Models\Order;

interface Refundable
{
    public function refund(Order $order): void;
}
