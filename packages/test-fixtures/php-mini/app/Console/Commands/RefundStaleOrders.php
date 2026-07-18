<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class RefundStaleOrders extends Command
{
    protected $signature = 'orders:refund-stale';

    public function handle(): int
    {
        return self::SUCCESS;
    }
}
