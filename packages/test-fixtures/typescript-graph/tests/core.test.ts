import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/core';

describe('add', () => {
  it('numbers', () => {
    assert.equal(add(1, 1), 2);
  });
});
