import type { BaseType } from './ir';

export type Scalar = number | string | boolean;
export type Value = Scalar | Scalar[];

/**
 * Canonical output formatting. The interpreter and every generated program must agree on
 * this, otherwise the CI diff tests fail. Reference: JavaScript's String(x).
 */
export function formatValue(v: Value): string {
  if (Array.isArray(v)) return '[' + v.map(formatValue).join(', ') + ']';
  return String(v);
}

export function defaultValue(base: BaseType): Scalar {
  switch (base) {
    case 'int':
    case 'real':
      return 0;
    case 'string':
      return '';
    case 'bool':
      return false;
  }
}
