import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HelloService, createHello } from '../src/hello';
import { add } from '../src/core';

describe('HelloService', () => {
  it('greets', () => {
    const s = createHello();
    assert.ok(s.greet('a').includes('a'));
  });

  it('adds', () => {
    assert.equal(add(1, 2), 3);
  });
});

describe('HelloService.sum', () => {
  it('uses add', () => {
    assert.equal(new HelloService().sum(2, 3), 5);
  });
});
