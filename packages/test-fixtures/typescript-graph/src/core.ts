/** Shared greeter interface. */
export interface Greeter {
  greet(name: string): string;
}

export type Id = string | number;

export enum Role {
  Admin = 'admin',
  User = 'user',
}

/** Adds two numbers. */
export function add(a: number, b: number): number;
export function add(a: string, b: string): string;
export function add(a: number | string, b: number | string): number | string {
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a) + String(b);
  }
  return a + b;
}

export const ANSWER = 42;

export class BaseService {
  constructor(readonly name: string) {}
  run(): string {
    return this.name;
  }
}
