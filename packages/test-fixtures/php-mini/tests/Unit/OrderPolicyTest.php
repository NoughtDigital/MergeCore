<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Policies\OrderPolicy;
use PHPUnit\Framework\TestCase;

class OrderPolicyTest extends TestCase
{
    public function test_refund_requires_authenticated_user(): void
    {
        $policy = new OrderPolicy();
        $order = new Order();
        $order->status = 'paid';
        $this->assertFalse($policy->refund(null, $order));
    }
}
