/**
 * Flowchart IR — the program model the editor produces and everything else consumes.
 *
 * The IR is *structured*: there are no free arrows. Compound blocks (if/while/for/doWhile)
 * own their nested block lists, so every chart maps 1:1 onto structured code in any target.
 *
 * `E` is the expression representation. The editor stores expressions as the text the user
 * typed (`Program<string>`, i.e. plain JSON). The checker parses and types them and produces
 * `Program<Expr>` (`TypedProgram`), which the interpreter and code generators consume.
 */
import type { Expr } from './ast';

export type BaseType = 'int' | 'real' | 'string' | 'bool';

export interface ScalarType { kind: 'scalar'; base: BaseType }
export interface ArrayType { kind: 'array'; base: BaseType }
export type VarType = ScalarType | ArrayType;

export const scalar = (base: BaseType): ScalarType => ({ kind: 'scalar', base });
export const arrayOf = (base: BaseType): ArrayType => ({ kind: 'array', base });
export const typeToString = (t: VarType): string => (t.kind === 'array' ? `${t.base}[]` : t.base);

export interface DeclareBlock<E> {
  id: string;
  kind: 'declare';
  name: string;
  type: BaseType;
  /** Present → declares an array of this size. */
  size?: E;
}

export interface AssignBlock<E> {
  id: string;
  kind: 'assign';
  target: string;
  /** Present → assigns to `target[index]`. */
  index?: E;
  value: E;
}

export interface InputBlock<E> {
  id: string;
  kind: 'input';
  target: string;
  index?: E;
  /** Filled in by the checker: the type the input must be parsed as. */
  type?: BaseType;
}

export interface OutputBlock<E> {
  id: string;
  kind: 'output';
  value: E;
  /** Defaults to true. */
  newline?: boolean;
}

export interface IfBlock<E> {
  id: string;
  kind: 'if';
  condition: E;
  then: Block<E>[];
  else: Block<E>[];
}

export interface WhileBlock<E> {
  id: string;
  kind: 'while';
  condition: E;
  body: Block<E>[];
}

export interface DoWhileBlock<E> {
  id: string;
  kind: 'doWhile';
  body: Block<E>[];
  condition: E;
}

export interface ForBlock<E> {
  id: string;
  kind: 'for';
  /** Must be a declared int variable. */
  variable: string;
  from: E;
  /** Inclusive. */
  to: E;
  /** Integer literal, nonzero. Defaults to 1. Negative counts down. */
  step?: number;
  body: Block<E>[];
}

export interface CallBlock<E> {
  id: string;
  kind: 'call';
  name: string;
  args: E[];
}

export interface CommentBlock {
  id: string;
  kind: 'comment';
  text: string;
}

export interface BreakBlock {
  id: string;
  kind: 'break';
}

export interface ReturnBlock<E> {
  id: string;
  kind: 'return';
  value?: E;
}

export type Block<E = string> =
  | DeclareBlock<E>
  | AssignBlock<E>
  | InputBlock<E>
  | OutputBlock<E>
  | IfBlock<E>
  | WhileBlock<E>
  | DoWhileBlock<E>
  | ForBlock<E>
  | CallBlock<E>
  | CommentBlock
  | BreakBlock
  | ReturnBlock<E>;

export interface Param {
  name: string;
  type: BaseType;
  array?: boolean;
}

export interface FunctionDef<E = string> {
  name: string;
  params: Param[];
  /** Absent → procedure (no return value). */
  returns?: BaseType;
  body: Block<E>[];
}

export interface Program<E = string> {
  version: 1;
  name?: string;
  main: Block<E>[];
  functions: FunctionDef<E>[];
}

export type TypedBlock = Block<Expr>;
export type TypedFunction = FunctionDef<Expr>;
export type TypedProgram = Program<Expr>;
