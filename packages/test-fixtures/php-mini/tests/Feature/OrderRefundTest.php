<?php

use App\Models\Order;

describe('Order', function () {
    test('can be refunded', function () {
        $order = new Order();
        $order->status = 'paid';
        $order->markRefunded();
        expect($order->status)->toBe('refunded');
    });
});
