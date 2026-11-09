import type { VarType } from './ir';

export type BinaryOp =
  | '+' | '-' | '*' | '/' | 'div' | '%' | '^'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

export type UnaryOp = '-' | 'not';

interface ExprBase {
  /** Character offset in the expression text (for error highlighting). */
  pos: number;
  /** Filled in by the checker. */
  type?: VarType;
}

export interface NumExpr extends ExprBase { kind: 'num'; value: number; isInt: boolean; text: string }
export interface StrExpr extends ExprBase { kind: 'str'; value: string }
export interface BoolExpr extends ExprBase { kind: 'bool'; value: boolean }
export interface VarExpr extends ExprBase { kind: 'var'; name: string }
export interface IndexExpr extends ExprBase {
  kind: 'index';
  name: string;
  index: Expr;
  /** Filled in by the checker: what is being indexed (an array, or a string for one character). */
  targetType?: VarType;
}
export interface UnaryExpr extends ExprBase { kind: 'unary'; op: UnaryOp; operand: Expr }
export interface BinaryExpr extends ExprBase { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
export interface CallExpr extends ExprBase { kind: 'call'; name: string; args: Expr[] }

export type Expr = NumExpr | StrExpr | BoolExpr | VarExpr | IndexExpr | UnaryExpr | BinaryExpr | CallExpr;
