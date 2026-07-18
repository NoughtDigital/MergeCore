import { BaseService, Greeter, add, type Id } from './core';
import { format } from '@lib/format';

export class HelloService extends BaseService implements Greeter {
  constructor() {
    super('hello');
  }

  greet(name: string): string {
    return format(this.run(), name);
  }

  sum(a: number, b: number): number {
    return add(a, b);
  }

  echoId(id: Id): Id {
    return id;
  }
}

export function createHello(): Greeter {
  return new HelloService();
}

export function callDynamic(obj: Record<string, () => void>, key: string): void {
  obj[key]();
}

export { add as reexportedAdd } from './core';
export { default as shout } from './default-export';
