import type { BaseType, VarType } from './ir';
import { scalar } from './ir';
import { formatValue, type Scalar, type Value } from './values';

/**
 * Parameter kinds:
 *   int/real/string/bool  exact scalar (int is accepted where real is expected)
 *   num                   int or real
 *   scalar                any scalar
 *   lenable               string or array
 */
export type BuiltinParam = BaseType | 'num' | 'scalar' | 'lenable';

export interface Builtin {
  name: string;
  params: BuiltinParam[];
  /** 'widest' → real if any numeric argument is real, else int. */
  returns: BaseType | 'widest';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  impl: (...args: any[]) => Scalar;
}

const list: Builtin[] = [
  { name: 'len', params: ['lenable'], returns: 'int', impl: (x: string | Value[]) => x.length },
  { name: 'abs', params: ['num'], returns: 'widest', impl: Math.abs },
  { name: 'sqrt', params: ['num'], returns: 'real', impl: Math.sqrt },
  { name: 'floor', params: ['num'], returns: 'int', impl: Math.floor },
  { name: 'ceil', params: ['num'], returns: 'int', impl: Math.ceil },
  { name: 'round', params: ['num'], returns: 'int', impl: Math.round },
  { name: 'min', params: ['num', 'num'], returns: 'widest', impl: Math.min },
  { name: 'max', params: ['num', 'num'], returns: 'widest', impl: Math.max },
  { name: 'pow', params: ['num', 'num'], returns: 'real', impl: Math.pow },
  { name: 'toInt', params: ['string'], returns: 'int', impl: (s: string) => parseInt(s, 10) },
  { name: 'toReal', params: ['string'], returns: 'real', impl: (s: string) => parseFloat(s) },
  { name: 'toString', params: ['scalar'], returns: 'string', impl: (v: Scalar) => formatValue(v) },
  { name: 'upper', params: ['string'], returns: 'string', impl: (s: string) => s.toUpperCase() },
  { name: 'lower', params: ['string'], returns: 'string', impl: (s: string) => s.toLowerCase() },
];

export const BUILTINS: ReadonlyMap<string, Builtin> = new Map(list.map((b) => [b.name, b]));

export function builtinReturnType(b: Builtin, argTypes: VarType[]): VarType {
  if (b.returns !== 'widest') return scalar(b.returns);
  const anyReal = argTypes.some((t) => t.kind === 'scalar' && t.base === 'real');
  return scalar(anyReal ? 'real' : 'int');
}

export function matchesParam(p: BuiltinParam, t: VarType): boolean {
  switch (p) {
    case 'num':
      return t.kind === 'scalar' && (t.base === 'int' || t.base === 'real');
    case 'scalar':
      return t.kind === 'scalar';
    case 'lenable':
      return t.kind === 'array' || (t.kind === 'scalar' && t.base === 'string');
    case 'real':
      return t.kind === 'scalar' && (t.base === 'real' || t.base === 'int');
    default:
      return t.kind === 'scalar' && t.base === p;
  }
}

export function describeParam(p: BuiltinParam): string {
  switch (p) {
    case 'num': return 'a number';
    case 'scalar': return 'a single value';
    case 'lenable': return 'a string or an array';
    default: return `a ${p}`;
  }
}
