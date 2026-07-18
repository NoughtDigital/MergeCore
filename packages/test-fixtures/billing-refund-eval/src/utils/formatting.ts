export function greet(name: string): string {
  return `hello ${name}`;
}

export function formatDate(d: Date): string {
  return d.toISOString();
}
