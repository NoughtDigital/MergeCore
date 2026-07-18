<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessRefund;
use App\Models\Order;
use App\Policies\OrderPolicy;
use Illuminate\Http\Request;

/**
 * Handles order HTTP endpoints.
 */
class OrderController
{
    public function __construct(
        private readonly OrderPolicy $policy,
    ) {
    }

    public function store(Request $request)
    {
        $order = Order::create($request->only(['total', 'status']));
        return response()->json($order, 201);
    }

    public function refund(Order $order)
    {
        $this->policy->refund(auth()->user(), $order);
        $this->dispatchRefund($order);
        return response()->json(['ok' => true]);
    }

    private function dispatchRefund(Order $order): void
    {
        ProcessRefund::dispatch($order);
    }
}
