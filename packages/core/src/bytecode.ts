import type { BinaryOp, Expr, UnaryOp } from './ast';
import { BUILTINS } from './builtins';
import { arrayOf, scalar, type BaseType, type Param, type TypedBlock, type TypedProgram, type VarType } from './ir';
import type { Scalar } from './values';

/**
 * A tiny stack machine. Structured control flow becomes jumps, expressions become
 * push/load/binary ops. Every instruction remembers the block it came from so the UI
 * can highlight the current block, set breakpoints on blocks, and "step" block by block.
 */
export type Instr = { blockId?: string } & (
  | { op: 'push'; value: Scalar }
  | { op: 'load'; name: string }
  | { op: 'loadIndex'; name: string }
  | { op: 'store'; name: string }
  | { op: 'storeIndex'; name: string }
  | { op: 'declare'; name: string; type: VarType }
  | { op: 'unary'; opr: UnaryOp }
  | { op: 'binary'; opr: BinaryOp }
  | { op: 'dup' }
  | { op: 'pop' }
  | { op: 'callBuiltin'; name: string; argc: number }
  | { op: 'call'; name: string; argc: number }
  | { op: 'jump'; target: number }
  | { op: 'jumpIfFalse'; target: number }
  | { op: 'jumpIfTrue'; target: number }
  | { op: 'input'; name: string; indexed: boolean; type: BaseType }
  | { op: 'output'; newline: boolean }
  | { op: 'return'; hasValue: boolean }
  | { op: 'halt' }
);

export interface FunctionEntry {
  name: string;
  entry: number;
  params: Param[];
  returns?: BaseType;
}

export interface CompiledProgram {
  typed: TypedProgram;
  code: Instr[];
  entries: ReadonlyMap<string, FunctionEntry>;
}

export function compileToBytecode(typed: TypedProgram): CompiledProgram {
  const c = new Compiler(typed);
  return { typed, code: c.code, entries: c.entries };
}

class Compiler {
  readonly code: Instr[] = [];
  readonly entries = new Map<string, FunctionEntry>();
  private readonly returnsValue = new Map<string, boolean>();
  /** Stack of loops; each holds the `jump` indices of `break`s waiting to be patched. */
  private loops: number[][] = [];

  constructor(typed: TypedProgram) {
    for (const fn of typed.functions) this.returnsValue.set(fn.name, fn.returns !== undefined);

    this.blocks(typed.main);
    this.emit({ op: 'halt' });

    for (const fn of typed.functions) {
      this.entries.set(fn.name, { name: fn.name, entry: this.code.length, params: fn.params, returns: fn.returns });
      this.blocks(fn.body);
      // Implicit return: fine for procedures; the VM reports E_NO_RETURN for value-returning functions.
      this.emit({ op: 'return', hasValue: false });
    }
  }

  private emit(instr: Instr, blockId?: string): number {
    this.code.push(blockId ? { ...instr, blockId } : instr);
    return this.code.length - 1;
  }

  private patch(index: number, target: number): void {
    (this.code[index] as { target: number }).target = target;
  }

  private get here(): number {
    return this.code.length;
  }

  private blocks(blocks: TypedBlock[]): void {
    for (const b of blocks) this.block(b);
  }

  private block(b: TypedBlock): void {
    const id = b.id;
    switch (b.kind) {
      case 'comment':
        return;

      case 'declare':
        if (b.size) this.expr(b.size, id);
        this.emit({ op: 'declare', name: b.name, type: b.size ? arrayOf(b.type) : scalar(b.type) }, id);
        return;

      case 'assign':
        this.expr(b.value, id);
        if (b.index) {
          this.expr(b.index, id);
          this.emit({ op: 'storeIndex', name: b.target }, id);
        } else {
          this.emit({ op: 'store', name: b.target }, id);
        }
        return;

      case 'input':
        if (b.index) this.expr(b.index, id);
        this.emit({ op: 'input', name: b.target, indexed: b.index !== undefined, type: b.type! }, id);
        return;

      case 'output':
        this.expr(b.value, id);
        this.emit({ op: 'output', newline: b.newline !== false }, id);
        return;

      case 'if': {
        this.expr(b.condition, id);
        const jf = this.emit({ op: 'jumpIfFalse', target: 0 }, id);
        this.blocks(b.then);
        if (b.else.length) {
          const je = this.emit({ op: 'jump', target: 0 }, id);
          this.patch(jf, this.here);
          this.blocks(b.else);
          this.patch(je, this.here);
        } else {
          this.patch(jf, this.here);
        }
        return;
      }

      case 'while': {
        const start = this.here;
        this.expr(b.condition, id);
        const jf = this.emit({ op: 'jumpIfFalse', target: 0 }, id);
        this.loops.push([]);
        this.blocks(b.body);
        this.emit({ op: 'jump', target: start }, id);
        this.patch(jf, this.here);
        this.patchBreaks();
        return;
      }

      case 'doWhile': {
        const start = this.here;
        this.loops.push([]);
        this.blocks(b.body);
        this.expr(b.condition, id);
        this.emit({ op: 'jumpIfTrue', target: start }, id);
        this.patchBreaks();
        return;
      }

      case 'for': {
        const step = b.step ?? 1;
        this.expr(b.from, id);
        this.emit({ op: 'store', name: b.variable }, id);
        const start = this.here;
        this.emit({ op: 'load', name: b.variable }, id);
        this.expr(b.to, id);
        this.emit({ op: 'binary', opr: step > 0 ? '<=' : '>=' }, id);
        const jf = this.emit({ op: 'jumpIfFalse', target: 0 }, id);
        this.loops.push([]);
        this.blocks(b.body);
        this.emit({ op: 'load', name: b.variable }, id);
        this.emit({ op: 'push', value: step }, id);
        this.emit({ op: 'binary', opr: '+' }, id);
        this.emit({ op: 'store', name: b.variable }, id);
        this.emit({ op: 'jump', target: start }, id);
        this.patch(jf, this.here);
        this.patchBreaks();
        return;
      }

      case 'call':
        for (const a of b.args) this.expr(a, id);
        this.emit({ op: 'call', name: b.name, argc: b.args.length }, id);
        if (this.returnsValue.get(b.name)) this.emit({ op: 'pop' }, id);
        return;

      case 'break':
        this.loops[this.loops.length - 1].push(this.emit({ op: 'jump', target: 0 }, id));
        return;

      case 'return':
        if (b.value) this.expr(b.value, id);
        this.emit({ op: 'return', hasValue: b.value !== undefined }, id);
        return;
    }
  }

  private patchBreaks(): void {
    for (const index of this.loops.pop() ?? []) this.patch(index, this.here);
  }

  private expr(e: Expr, id: string): void {
    switch (e.kind) {
      case 'num':
      case 'str':
      case 'bool':
        this.emit({ op: 'push', value: e.value }, id);
        return;
      case 'var':
        this.emit({ op: 'load', name: e.name }, id);
        return;
      case 'index':
        this.expr(e.index, id);
        this.emit({ op: 'loadIndex', name: e.name }, id);
        return;
      case 'unary':
        this.expr(e.operand, id);
        this.emit({ op: 'unary', opr: e.op }, id);
        return;
      case 'binary': {
        if (e.op === 'and' || e.op === 'or') {
          // Short-circuit, matching && / || in every target language.
          this.expr(e.left, id);
          this.emit({ op: 'dup' }, id);
          const skip = this.emit({ op: e.op === 'and' ? 'jumpIfFalse' : 'jumpIfTrue', target: 0 }, id);
          this.emit({ op: 'pop' }, id);
          this.expr(e.right, id);
          this.patch(skip, this.here);
          return;
        }
        this.expr(e.left, id);
        this.expr(e.right, id);
        this.emit({ op: 'binary', opr: e.op }, id);
        return;
      }
      case 'call':
        for (const a of e.args) this.expr(a, id);
        if (BUILTINS.has(e.name)) this.emit({ op: 'callBuiltin', name: e.name, argc: e.args.length }, id);
        else this.emit({ op: 'call', name: e.name, argc: e.args.length }, id);
        return;
    }
  }
}
