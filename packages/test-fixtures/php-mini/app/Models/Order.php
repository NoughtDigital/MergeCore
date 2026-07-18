<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Order aggregate root for billing demos.
 */
class Order extends Model
{
    protected $fillable = ['total', 'status'];

    public function markRefunded(): void
    {
        $this->status = 'refunded';
        $this->save();
    }
}
