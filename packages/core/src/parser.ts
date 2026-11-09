import type { BinaryOp, Expr } from './ast';
import { ExprError } from './errors';
import { tokenize, type Token, type TokenKind } from './lexer';

/**
 * Precedence, lowest to highest:
 *   or  <  and  <  not  <  comparison  <  + -  <  * / % div  <  unary -  <  ^ (right-assoc)  <  call / index
 *
 * So `not a == b` is `not (a == b)` and `-2 ^ 2` is `-(2 ^ 2)`, matching Python and maths.
 */
export function parseExpression(src: string): Expr {
  if (src.trim() === '') throw new ExprError('E_EMPTY_EXPR', 'Expression is empty', 0);
  const parser = new Parser(tokenize(src));
  const expr = parser.parseOr();
  parser.expectEnd();
  return expr;
}

const binary = (op: BinaryOp, left: Expr, right: Expr, pos: number): Expr => ({ kind: 'binary', op, left, right, pos });

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.i]; }
  private advance(): Token { return this.tokens[this.i++]; }
  private at(kind: TokenKind): boolean { return this.peek().kind === kind; }
  private atOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.kind === 'op' && ops.includes(t.text);
  }
  private expect(kind: TokenKind, what: string): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new ExprError('E_EXPECTED', `Expected ${what}`, t.pos);
    return this.advance();
  }

  expectEnd(): void {
    const t = this.peek();
    if (t.kind !== 'eof') throw new ExprError('E_UNEXPECTED_TOKEN', `Unexpected "${t.text}"`, t.pos);
  }

  parseOr(): Expr {
    let left = this.parseAnd();
    while (this.atOp('or')) {
      const t = this.advance();
      left = binary('or', left, this.parseAnd(), t.pos);
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.atOp('and')) {
      const t = this.advance();
      left = binary('and', left, this.parseNot(), t.pos);
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.atOp('not')) {
      const t = this.advance();
      return { kind: 'unary', op: 'not', operand: this.parseNot(), pos: t.pos };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.atOp('==', '!=', '<', '<=', '>', '>=')) {
      const t = this.advance();
      left = binary(t.text as BinaryOp, left, this.parseAdditive(), t.pos);
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.atOp('+', '-')) {
      const t = this.advance();
      left = binary(t.text as BinaryOp, left, this.parseMultiplicative(), t.pos);
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.atOp('*', '/', '%', 'div')) {
      const t = this.advance();
      left = binary(t.text as BinaryOp, left, this.parseUnary(), t.pos);
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.atOp('-')) {
      const t = this.advance();
      return { kind: 'unary', op: '-', operand: this.parseUnary(), pos: t.pos };
    }
    if (this.atOp('+')) {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.atOp('^')) {
      const t = this.advance();
      // Right-associative, and the exponent may carry its own sign: 2 ^ -1
      return binary('^', base, this.parseUnary(), t.pos);
    }
    return base;
  }

  private parsePostfix(): Expr {
    const t = this.peek();

    if (t.kind === 'num') {
      this.advance();
      return { kind: 'num', value: t.value as number, isInt: t.isInt === true, text: t.text, pos: t.pos };
    }
    if (t.kind === 'str') {
      this.advance();
      return { kind: 'str', value: t.value as string, pos: t.pos };
    }
    if (t.kind === 'bool') {
      this.advance();
      return { kind: 'bool', value: t.value as boolean, pos: t.pos };
    }
    if (t.kind === 'ident') {
      this.advance();
      if (this.at('lparen')) {
        this.advance();
        const args: Expr[] = [];
        if (!this.at('rparen')) {
          args.push(this.parseOr());
          while (this.at('comma')) {
            this.advance();
            args.push(this.parseOr());
          }
        }
        this.expect('rparen', '")"');
        return { kind: 'call', name: t.text, args, pos: t.pos };
      }
      if (this.at('lbracket')) {
        this.advance();
        const index = this.parseOr();
        this.expect('rbracket', '"]"');
        return { kind: 'index', name: t.text, index, pos: t.pos };
      }
      return { kind: 'var', name: t.text, pos: t.pos };
    }
    if (t.kind === 'lparen') {
      this.advance();
      const inner = this.parseOr();
      this.expect('rparen', '")"');
      return inner;
    }

    throw new ExprError('E_EXPECTED_EXPR', t.kind === 'eof' ? 'Expression ends unexpectedly' : `Unexpected "${t.text}"`, t.pos);
  }
}
