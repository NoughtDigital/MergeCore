<?php

namespace App\Models;

use App\Concerns\LogsActivity;
use App\Enums\OrderStatus;
use Illuminate\Database\Eloquent\Model;

/**
 * Order aggregate root for billing demos.
 */
class Order extends Model
{
    use LogsActivity;

    protected $fillable = ['total', 'status'];

    public function markRefunded(): void
    {
        $this->status = OrderStatus::Refunded->value;
        $this->logActivity('order refunded');
        $this->save();
    }
}
