import { createHello } from './hello';
import { add } from './core';

export function main(): string {
  const g = createHello();
  const n = add(1, 2);
  return g.greet(`world-${n}`);
}

export function indirect(): string {
  return main();
}
