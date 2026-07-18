import { formatGreeting, add } from './util';

export function greet(name: string): string {
  return formatGreeting(name);
}

export function sum(a: number, b: number): number {
  return add(a, b);
}

export type Greeter = {
  greet(name: string): string;
};
