import type { BinaryOp } from './ast';
import { BUILTINS } from './builtins';
import type { CompiledProgram, Instr } from './bytecode';
import type { RuntimeError } from './errors';
import { arrayOf, scalar, type BaseType, type VarType } from './ir';
import { defaultValue, formatValue, type Scalar, type Value } from './values';

export type RunStatus = 'ready' | 'waitingInput' | 'paused' | 'finished' | 'error';
export type PauseReason = 'breakpoint' | 'step' | 'budget';

export interface PendingInput {
  name: string;
  index?: number;
  type: BaseType;
}

export interface VariableView {
  name: string;
  type: VarType;
  value: Value;
}

interface Frame {
  name: string;
  locals: Map<string, Value>;
  types: Map<string, VarType>;
  returnPc: number;
  stackBase: number;
  returns?: BaseType;
}

/**
 * Drives one program. Typical UI loop:
 *
 *   const r = new Runner(compiled);
 *   r.breakpoints.add('b7');
 *   r.run();                        // → 'waitingInput' | 'paused' | 'finished' | 'error'
 *   if (r.status === 'waitingInput') r.provideInput(textFromUser), r.run();
 *   r.step();                       // executes one block
 *   r.currentBlockId, r.variables(), r.output, r.partialLine
 */
export class Runner {
  /** Completed output lines. */
  readonly output: string[] = [];
  /** Text written since the last newline (a prompt waiting for input, typically). */
  partialLine = '';
  status: RunStatus = 'ready';
  pauseReason: PauseReason | null = null;
  error: RuntimeError | null = null;
  pendingInput: PendingInput | null = null;
  readonly breakpoints = new Set<string>();
  maxCallDepth = 5000;

  private pc = 0;
  private stack: Value[] = [];
  private frames: Frame[] = [{ name: 'main', locals: new Map(), types: new Map(), returnPc: -1, stackBase: 0 }];
  private lastBlockId: string | undefined;
  private stepsSinceResume = 0;

  constructor(private readonly program: CompiledProgram) {}

  /**
   * The block to highlight: normally the one about to execute. While waiting for input it is
   * the Input block itself (its instruction has already run and moved the program counter on),
   * and after an error it is the block that failed.
   */
  get currentBlockId(): string | undefined {
    if (this.status === 'waitingInput' || this.status === 'error') return this.lastBlockId;
    return this.program.code[this.pc]?.blockId;
  }

  get outputText(): string {
    return this.output.map((l) => l + '\n').join('') + this.partialLine;
  }

  get callStack(): string[] {
    return this.frames.map((f) => f.name);
  }

  variables(): VariableView[] {
    const f = this.frame;
    return [...f.locals].map(([name, value]) => ({ name, type: f.types.get(name) ?? scalar('int'), value }));
  }

  /** Continue until input is needed, a breakpoint is hit, the step budget runs out, or the program ends. */
  run(maxSteps = 1_000_000): RunStatus {
    if (!this.canRun()) return this.status;
    this.status = 'ready';
    this.pauseReason = null;
    this.stepsSinceResume = 0;
    let steps = 0;

    while (this.status === 'ready') {
      const instr = this.program.code[this.pc];
      if (!instr) { this.finish(); break; }
      const entering = instr.blockId !== undefined && instr.blockId !== this.lastBlockId;
      if (this.stepsSinceResume > 0 && entering && this.breakpoints.has(instr.blockId!)) {
        this.pause('breakpoint');
        break;
      }
      if (steps++ >= maxSteps) { this.pause('budget'); break; }
      this.exec(instr);
    }
    return this.status;
  }

  /** Execute the current block and stop at the next one. */
  step(maxSteps = 1_000_000): RunStatus {
    if (!this.canRun()) return this.status;
    this.status = 'ready';
    this.pauseReason = null;
    const startBlock = this.currentBlockId;
    let steps = 0;

    while (this.status === 'ready') {
      const instr = this.program.code[this.pc];
      if (!instr) { this.finish(); break; }
      // Instructions without a block (halt, implicit return) never count as a new block.
      if (steps > 0 && instr.blockId !== undefined && instr.blockId !== startBlock) { this.pause('step'); break; }
      if (steps++ >= maxSteps) { this.pause('budget'); break; }
      this.exec(instr);
    }
    return this.status;
  }

  provideInput(line: string): void {
    if (this.status !== 'waitingInput' || !this.pendingInput) return;
    const { name, index, type } = this.pendingInput;
    const value = parseInput(line, type);
    if (value === undefined) {
      this.fail('E_INPUT_INVALID', `Expected a ${type}, got "${line}"`);
      return;
    }
    const locals = this.frame.locals;
    if (index !== undefined) {
      const arr = locals.get(name) as Scalar[];
      if (index < 0 || index >= arr.length) { this.fail('E_INDEX_RANGE', `Index ${index} is out of range for "${name}" (size ${arr.length})`); return; }
      arr[index] = value;
    } else {
      locals.set(name, value);
    }
    this.pendingInput = null;
    this.status = 'ready';
  }

  // ---------------------------------------------------------------------------

  private get frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private canRun(): boolean {
    return this.status === 'ready' || this.status === 'paused';
  }

  private pause(reason: PauseReason): void {
    this.status = 'paused';
    this.pauseReason = reason;
  }

  private finish(): void {
    this.status = 'finished';
  }

  private fail(code: string, message: string): void {
    this.status = 'error';
    this.error = { code, message, blockId: this.lastBlockId };
  }

  private pop(): Value {
    return this.stack.pop()!;
  }

  private exec(instr: Instr): void {
    this.lastBlockId = instr.blockId;
    this.stepsSinceResume++;
    this.pc++;
    const locals = this.frame.locals;

    switch (instr.op) {
      case 'push':
        this.stack.push(instr.value);
        return;

      case 'load': {
        const v = locals.get(instr.name);
        if (v === undefined) { this.fail('E_UNDEFINED_VAR', `"${instr.name}" has no value here`); return; }
        this.stack.push(v);
        return;
      }

      case 'loadIndex': {
        const index = this.pop() as number;
        const target = locals.get(instr.name);
        if (!Array.isArray(target) && typeof target !== 'string') { this.fail('E_UNDEFINED_VAR', `"${instr.name}" has no value here`); return; }
        if (index < 0 || index >= target.length) { this.fail('E_INDEX_RANGE', `Index ${index} is out of range for "${instr.name}" (length ${target.length})`); return; }
        this.stack.push(target[index]);
        return;
      }

      case 'store':
        locals.set(instr.name, this.pop());
        return;

      case 'storeIndex': {
        const index = this.pop() as number;
        const value = this.pop() as Scalar;
        const arr = locals.get(instr.name) as Scalar[];
        if (index < 0 || index >= arr.length) { this.fail('E_INDEX_RANGE', `Index ${index} is out of range for "${instr.name}" (size ${arr.length})`); return; }
        arr[index] = value;
        return;
      }

      case 'declare': {
        if (instr.type.kind === 'array') {
          const size = this.pop() as number;
          if (size < 0) { this.fail('E_ARRAY_SIZE', `Array size cannot be negative (${size})`); return; }
          locals.set(instr.name, new Array<Scalar>(size).fill(defaultValue(instr.type.base)));
        } else {
          locals.set(instr.name, defaultValue(instr.type.base));
        }
        this.frame.types.set(instr.name, instr.type);
        return;
      }

      case 'unary': {
        const v = this.pop();
        this.stack.push(instr.opr === 'not' ? !(v as boolean) : -(v as number));
        return;
      }

      case 'binary': {
        const r = this.pop() as Scalar;
        const l = this.pop() as Scalar;
        const result = this.binary(instr.opr, l, r);
        if (result !== undefined) this.stack.push(result);
        return;
      }

      case 'dup':
        this.stack.push(this.stack[this.stack.length - 1]);
        return;

      case 'pop':
        this.stack.pop();
        return;

      case 'callBuiltin': {
        const args = instr.argc === 0 ? [] : this.stack.splice(-instr.argc);
        this.stack.push(BUILTINS.get(instr.name)!.impl(...args));
        return;
      }

      case 'call': {
        const entry = this.program.entries.get(instr.name)!;
        const args = instr.argc === 0 ? [] : this.stack.splice(-instr.argc);
        if (this.frames.length >= this.maxCallDepth) { this.fail('E_STACK_OVERFLOW', `Too many nested calls (${this.maxCallDepth}); is "${instr.name}" recursing forever?`); return; }
        const frame: Frame = {
          name: entry.name,
          locals: new Map(),
          types: new Map(),
          returnPc: this.pc,
          stackBase: this.stack.length,
          returns: entry.returns,
        };
        entry.params.forEach((p, i) => {
          frame.locals.set(p.name, args[i]);
          frame.types.set(p.name, p.array ? arrayOf(p.type) : scalar(p.type));
        });
        this.frames.push(frame);
        this.pc = entry.entry;
        return;
      }

      case 'jump':
        this.pc = instr.target;
        return;

      case 'jumpIfFalse':
        if (!(this.pop() as boolean)) this.pc = instr.target;
        return;

      case 'jumpIfTrue':
        if (this.pop() as boolean) this.pc = instr.target;
        return;

      case 'input': {
        const index = instr.indexed ? (this.pop() as number) : undefined;
        this.pendingInput = { name: instr.name, index, type: instr.type };
        this.status = 'waitingInput';
        return;
      }

      case 'output': {
        this.partialLine += formatValue(this.pop());
        if (instr.newline) {
          this.output.push(this.partialLine);
          this.partialLine = '';
        }
        return;
      }

      case 'return': {
        const value = instr.hasValue ? this.pop() : undefined;
        if (this.frames.length === 1) { this.finish(); return; }
        const frame = this.frames.pop()!;
        if (frame.returns !== undefined && value === undefined) {
          this.fail('E_NO_RETURN', `"${frame.name}" ended without returning a value`);
          return;
        }
        this.stack.length = frame.stackBase;
        this.pc = frame.returnPc;
        if (value !== undefined) this.stack.push(value);
        return;
      }

      case 'halt':
        this.finish();
        return;
    }
  }

  private binary(op: BinaryOp, l: Scalar, r: Scalar): Scalar | undefined {
    switch (op) {
      case '+':
        if (typeof l === 'string' || typeof r === 'string') return formatValue(l) + formatValue(r);
        return (l as number) + (r as number);
      case '-': return (l as number) - (r as number);
      case '*': return (l as number) * (r as number);
      case '/':
        if (r === 0) { this.fail('E_DIV_ZERO', 'Division by zero'); return undefined; }
        return (l as number) / (r as number);
      case 'div':
        if (r === 0) { this.fail('E_DIV_ZERO', 'Division by zero'); return undefined; }
        return Math.trunc((l as number) / (r as number));
      case '%':
        if (r === 0) { this.fail('E_DIV_ZERO', 'Division by zero'); return undefined; }
        return (l as number) % (r as number);
      case '^': return Math.pow(l as number, r as number);
      case '==': return l === r;
      case '!=': return l !== r;
      case '<': return l < r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '>=': return l >= r;
      case 'and': return (l as boolean) && (r as boolean);
      case 'or': return (l as boolean) || (r as boolean);
    }
  }
}

export function parseInput(line: string, type: BaseType): Scalar | undefined {
  const t = line.trim();
  switch (type) {
    case 'int':
      return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : undefined;
    case 'real':
      return t !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined;
    case 'bool': {
      const l = t.toLowerCase();
      if (l === 'true' || l === 'doğru') return true;
      if (l === 'false' || l === 'yanlış') return false;
      return undefined;
    }
    case 'string':
      return line;
  }
}

/** Run to completion with scripted input lines. Handy for tests and the CLI. */
export function runProgram(
  compiled: CompiledProgram,
  inputs: string[] = [],
  maxSteps = 1_000_000,
): { output: string; status: RunStatus; error: RuntimeError | null } {
  const r = new Runner(compiled);
  let i = 0;
  r.run(maxSteps);
  while (r.status === 'waitingInput') {
    r.provideInput(inputs[i++] ?? '');
    r.run(maxSteps);
  }
  return { output: r.outputText, status: r.status, error: r.error };
}
