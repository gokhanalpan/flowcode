import type { BinaryOp, Expr } from './ast';
import { BUILTINS, builtinReturnType, describeParam, matchesParam } from './builtins';
import { CompileError, ExprError, type Diagnostic } from './errors';
import {
  arrayOf,
  scalar,
  typeToString,
  type BaseType,
  type Block,
  type Param,
  type Program,
  type TypedBlock,
  type TypedProgram,
  type VarType,
} from './ir';
import { IDENTIFIER_RE, isReservedWord } from './lexer';
import { parseExpression } from './parser';

export interface CheckResult {
  program: TypedProgram;
  diagnostics: Diagnostic[];
}

const T = {
  int: scalar('int'),
  real: scalar('real'),
  string: scalar('string'),
  bool: scalar('bool'),
};

/**
 * Names that would collide with keywords or runtime helpers in at least one target language.
 * Rejecting them up front keeps every generator free of renaming logic.
 */
const RESERVED_NAMES = new Set([
  // JS / TS
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'static',
  'implements', 'interface', 'package', 'private', 'protected', 'public', 'undefined', 'NaN', 'Infinity', 'Math', 'String',
  // Python
  'def', 'elif', 'except', 'from', 'global', 'lambda', 'nonlocal', 'pass', 'raise', 'assert', 'as', 'is', 'None', 'True',
  'False', 'print', 'input', 'int', 'float', 'str', 'list', 'range', 'sum', 'main',
  // C# / C++
  'bool', 'char', 'double', 'long', 'short', 'signed', 'unsigned', 'struct', 'union', 'namespace', 'using', 'template',
  'typename', 'virtual', 'operator', 'sizeof', 'goto', 'auto', 'register', 'volatile', 'extern', 'inline', 'string',
  'object', 'decimal', 'byte', 'sbyte', 'uint', 'ulong', 'ushort', 'checked', 'unchecked', 'fixed', 'lock', 'out', 'ref',
  'params', 'readonly', 'sealed', 'stackalloc', 'unsafe', 'event', 'explicit', 'implicit', 'foreach', 'abstract', 'base',
  'std', 'cin', 'cout', 'endl', 'Console',
  // FlowCode runtime helpers and generated scaffolding
  'readLine', 'write', 'writeln', 'fmt', 'mod', 'Fmt', 'Main', 'Program', 'Array',
]);

interface FnSig {
  params: VarType[];
  returns?: BaseType;
}

class Scope {
  private readonly stack: Map<string, VarType>[] = [new Map()];

  push(): void { this.stack.push(new Map()); }
  pop(): void { this.stack.pop(); }
  lookup(name: string): VarType | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const t = this.stack[i].get(name);
      if (t) return t;
    }
    return undefined;
  }
  declare(name: string, type: VarType): void { this.stack[this.stack.length - 1].set(name, type); }
}

interface Ctx {
  fnName?: string;
  scope: Scope;
  returns?: BaseType;
  loopDepth: number;
}

const isNum = (t: VarType): boolean => t.kind === 'scalar' && (t.base === 'int' || t.base === 'real');
const isScalarOf = (t: VarType, base: BaseType): boolean => t.kind === 'scalar' && t.base === base;
const paramType = (p: Param): VarType => (p.array ? arrayOf(p.type) : scalar(p.type));

/** `int` is implicitly promoted to `real`; nothing else converts implicitly. */
export function assignable(from: VarType, to: VarType): boolean {
  if (from.kind !== to.kind) return false;
  if (from.base === to.base) return true;
  return from.kind === 'scalar' && from.base === 'int' && to.base === 'real';
}

export function checkProgram(program: Program): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const sigs = new Map<string, FnSig>();

  for (const fn of program.functions) {
    if (sigs.has(fn.name)) {
      diagnostics.push({ code: 'E_FN_DUPLICATE', message: `Function "${fn.name}" is defined more than once`, fn: fn.name });
    } else if (BUILTINS.has(fn.name) || !isValidName(fn.name)) {
      diagnostics.push({ code: 'E_FN_NAME', message: `"${fn.name}" cannot be used as a function name`, fn: fn.name });
    }
    sigs.set(fn.name, { params: fn.params.map(paramType), returns: fn.returns });
  }

  const main = checkFunction(undefined, program.main, [], undefined);
  const functions = program.functions.map((fn) => ({
    name: fn.name,
    params: fn.params,
    returns: fn.returns,
    body: checkFunction(fn.name, fn.body, fn.params, fn.returns),
  }));

  return { program: { version: 1, name: program.name, main, functions }, diagnostics };

  // ---------------------------------------------------------------------------

  function checkFunction(fnName: string | undefined, body: Block[], params: Param[], returns?: BaseType): TypedBlock[] {
    const scope = new Scope();
    for (const p of params) {
      if (scope.lookup(p.name) || !isValidName(p.name)) {
        diagnostics.push({ code: 'E_PARAM_NAME', message: `Invalid or duplicate parameter name "${p.name}"`, fn: fnName });
      }
      scope.declare(p.name, paramType(p));
    }
    return checkBlocks(body, { fnName, scope, returns, loopDepth: 0 });
  }

  function checkBlocks(blocks: Block[], ctx: Ctx): TypedBlock[] {
    ctx.scope.push();
    try {
      return blocks.map((b) => checkBlock(b, ctx));
    } finally {
      ctx.scope.pop();
    }
  }

  function checkBlock(b: Block, ctx: Ctx): TypedBlock {
    try {
      return checkBlockInner(b, ctx);
    } catch (err) {
      if (err instanceof CompileError || err instanceof ExprError) {
        diagnostics.push({ code: err.code, message: err.message, blockId: b.id, fn: ctx.fnName, pos: err.pos });
        return { id: b.id, kind: 'comment', text: '' };
      }
      throw err;
    }
  }

  /** Runs `fn`, recording the first error instead of throwing, so sibling/child checks still run. */
  function guard<R>(fn: () => R, errors: unknown[]): R | undefined {
    try {
      return fn();
    } catch (err) {
      errors.push(err);
      return undefined;
    }
  }

  function checkBlockInner(b: Block, ctx: Ctx): TypedBlock {
    switch (b.kind) {
      case 'comment':
        return b;

      case 'break':
        if (ctx.loopDepth === 0) throw new CompileError('E_BREAK_OUTSIDE_LOOP', 'Break is only allowed inside a loop');
        return b;

      case 'declare': {
        if (!isValidName(b.name)) throw new CompileError('E_BAD_NAME', `"${b.name}" is not a valid variable name`);
        if (ctx.scope.lookup(b.name)) throw new CompileError('E_REDECLARED', `"${b.name}" is already declared`);
        if (sigs.has(b.name)) throw new CompileError('E_NAME_CONFLICT', `"${b.name}" is already the name of a function`);
        let size: Expr | undefined;
        if (b.size !== undefined) {
          size = expr(b.size, ctx);
          if (!isScalarOf(size.type!, 'int')) throw new CompileError('E_TYPE_ARRAY_SIZE', 'Array size must be an integer', size.pos);
        }
        ctx.scope.declare(b.name, size ? arrayOf(b.type) : scalar(b.type));
        return { ...b, size };
      }

      case 'assign': {
        const { index, elementType } = resolveTarget(b.target, b.index, ctx);
        const value = expr(b.value, ctx);
        if (!assignable(value.type!, elementType)) {
          throw new CompileError(
            'E_TYPE_ASSIGN',
            `Cannot assign ${typeToString(value.type!)} to ${typeToString(elementType)} "${b.target}"`,
            value.pos,
          );
        }
        return { ...b, index, value };
      }

      case 'input': {
        const { index, elementType } = resolveTarget(b.target, b.index, ctx);
        return { ...b, index, type: elementType.base };
      }

      case 'output': {
        const value = expr(b.value, ctx);
        if (value.type!.kind === 'array') throw new CompileError('E_OUTPUT_ARRAY', 'Cannot output a whole array; output one element', value.pos);
        return { ...b, value };
      }

      case 'if': {
        const errors: unknown[] = [];
        const condition = guard(() => condition_(b.condition, ctx), errors);
        const thenBlocks = checkBlocks(b.then, ctx);
        const elseBlocks = checkBlocks(b.else ?? [], ctx);
        if (errors.length) throw errors[0];
        return { ...b, condition: condition!, then: thenBlocks, else: elseBlocks };
      }

      case 'while': {
        const errors: unknown[] = [];
        const condition = guard(() => condition_(b.condition, ctx), errors);
        const body = loopBody(b.body, ctx);
        if (errors.length) throw errors[0];
        return { ...b, condition: condition!, body };
      }

      case 'doWhile': {
        const errors: unknown[] = [];
        const body = loopBody(b.body, ctx);
        const condition = guard(() => condition_(b.condition, ctx), errors);
        if (errors.length) throw errors[0];
        return { ...b, condition: condition!, body };
      }

      case 'for': {
        const errors: unknown[] = [];
        const header = guard(() => {
          const v = lookupVar(b.variable, ctx);
          if (!isScalarOf(v, 'int')) throw new CompileError('E_FOR_VAR', `Loop variable "${b.variable}" must be an int variable`);
          const from = expr(b.from, ctx);
          if (!isScalarOf(from.type!, 'int')) throw new CompileError('E_TYPE_FOR_BOUND', 'Loop start must be an integer', from.pos);
          const to = expr(b.to, ctx);
          if (!isScalarOf(to.type!, 'int')) throw new CompileError('E_TYPE_FOR_BOUND', 'Loop end must be an integer', to.pos);
          const step = b.step ?? 1;
          if (!Number.isInteger(step) || step === 0) throw new CompileError('E_FOR_STEP', 'Loop step must be a nonzero integer');
          return { from, to, step };
        }, errors);
        const body = loopBody(b.body, ctx);
        if (errors.length) throw errors[0];
        return { ...b, from: header!.from, to: header!.to, step: header!.step, body };
      }

      case 'call': {
        const sig = sigs.get(b.name);
        if (!sig) {
          if (BUILTINS.has(b.name)) throw new CompileError('E_CALL_BUILTIN', `Built-in "${b.name}" returns a value; use it inside an expression`);
          throw new CompileError('E_FN_UNKNOWN', `Unknown function "${b.name}"`);
        }
        const args = b.args.map((a) => expr(a, ctx));
        checkArgs(b.name, sig, args);
        return { ...b, args };
      }

      case 'return': {
        if (ctx.fnName === undefined) {
          if (b.value !== undefined) throw new CompileError('E_RETURN_VALUE_MAIN', 'The main program cannot return a value');
          return { id: b.id, kind: 'return' };
        }
        if (ctx.returns === undefined) {
          if (b.value !== undefined) throw new CompileError('E_RETURN_VALUE_PROC', `"${ctx.fnName}" has no return type`);
          return { id: b.id, kind: 'return' };
        }
        if (b.value === undefined) throw new CompileError('E_RETURN_MISSING_VALUE', `"${ctx.fnName}" must return a ${ctx.returns}`);
        const value = expr(b.value, ctx);
        if (!assignable(value.type!, scalar(ctx.returns))) {
          throw new CompileError('E_TYPE_RETURN', `"${ctx.fnName}" must return ${ctx.returns}, not ${typeToString(value.type!)}`, value.pos);
        }
        return { id: b.id, kind: 'return', value };
      }
    }
  }

  function loopBody(blocks: Block[], ctx: Ctx): TypedBlock[] {
    ctx.loopDepth++;
    try {
      return checkBlocks(blocks, ctx);
    } finally {
      ctx.loopDepth--;
    }
  }

  function resolveTarget(target: string, indexText: string | undefined, ctx: Ctx): { index?: Expr; elementType: VarType } {
    const t = lookupVar(target, ctx);
    if (indexText !== undefined) {
      if (isScalarOf(t, 'string')) throw new CompileError('E_STRING_IMMUTABLE', `The letters of "${target}" can't be changed one at a time; build a new text instead`);
      if (t.kind !== 'array') throw new CompileError('E_NOT_ARRAY', `"${target}" is not an array`);
      const index = expr(indexText, ctx);
      if (!isScalarOf(index.type!, 'int')) throw new CompileError('E_TYPE_INDEX', 'Array index must be an integer', index.pos);
      return { index, elementType: scalar(t.base) };
    }
    if (t.kind === 'array') throw new CompileError('E_WHOLE_ARRAY', `"${target}" is an array; use an index`);
    return { elementType: t };
  }

  function condition_(text: string, ctx: Ctx): Expr {
    const e = expr(text, ctx);
    if (!isScalarOf(e.type!, 'bool')) throw new CompileError('E_TYPE_CONDITION', `Condition must be true/false, not ${typeToString(e.type!)}`, e.pos);
    return e;
  }

  function expr(text: string, ctx: Ctx): Expr {
    const e = parseExpression(text);
    checkExpr(e, ctx);
    return e;
  }

  function lookupVar(name: string, ctx: Ctx, pos?: number): VarType {
    const t = ctx.scope.lookup(name);
    if (!t) throw new CompileError('E_UNDECLARED', `"${name}" is not declared`, pos);
    return t;
  }

  function checkExpr(e: Expr, ctx: Ctx): VarType {
    const t = inferExpr(e, ctx);
    e.type = t;
    return t;
  }

  function inferExpr(e: Expr, ctx: Ctx): VarType {
    switch (e.kind) {
      case 'num':
        return e.isInt ? T.int : T.real;
      case 'str':
        return T.string;
      case 'bool':
        return T.bool;
      case 'var':
        return lookupVar(e.name, ctx, e.pos);
      case 'index': {
        // Arrays index to an element; a string indexes to a one-character string.
        const t = lookupVar(e.name, ctx, e.pos);
        if (t.kind !== 'array' && !isScalarOf(t, 'string')) throw new CompileError('E_NOT_INDEXABLE', `"${e.name}" is not an array or a text`, e.pos);
        const it = checkExpr(e.index, ctx);
        if (!isScalarOf(it, 'int')) throw new CompileError('E_TYPE_INDEX', 'Index must be an integer', e.index.pos);
        e.targetType = t;
        return t.kind === 'array' ? scalar(t.base) : T.string;
      }
      case 'unary': {
        const t = checkExpr(e.operand, ctx);
        if (e.op === 'not') {
          if (!isScalarOf(t, 'bool')) throw new CompileError('E_TYPE_OPERATOR', `"not" needs a true/false value, not ${typeToString(t)}`, e.pos);
          return T.bool;
        }
        if (!isNum(t)) throw new CompileError('E_TYPE_OPERATOR', `Cannot negate ${typeToString(t)}`, e.pos);
        return t;
      }
      case 'binary': {
        const l = checkExpr(e.left, ctx);
        const r = checkExpr(e.right, ctx);
        return binaryType(e.op, l, r, e.pos);
      }
      case 'call': {
        const argTypes = e.args.map((a) => checkExpr(a, ctx));
        const builtin = BUILTINS.get(e.name);
        if (builtin) {
          if (argTypes.length !== builtin.params.length) {
            throw new CompileError('E_ARG_COUNT', `"${e.name}" takes ${builtin.params.length} argument(s)`, e.pos);
          }
          builtin.params.forEach((p, i) => {
            if (!matchesParam(p, argTypes[i])) {
              throw new CompileError('E_TYPE_ARG', `Argument ${i + 1} of "${e.name}" must be ${describeParam(p)}`, e.args[i].pos);
            }
          });
          return builtinReturnType(builtin, argTypes);
        }
        const sig = sigs.get(e.name);
        if (!sig) throw new CompileError('E_FN_UNKNOWN', `Unknown function "${e.name}"`, e.pos);
        checkArgs(e.name, sig, e.args);
        if (sig.returns === undefined) throw new CompileError('E_FN_NO_VALUE', `"${e.name}" does not return a value`, e.pos);
        return scalar(sig.returns);
      }
    }
  }

  function checkArgs(name: string, sig: FnSig, args: Expr[]): void {
    if (args.length !== sig.params.length) {
      throw new CompileError('E_ARG_COUNT', `"${name}" takes ${sig.params.length} argument(s), got ${args.length}`);
    }
    sig.params.forEach((p, i) => {
      if (!assignable(args[i].type!, p)) {
        throw new CompileError('E_TYPE_ARG', `Argument ${i + 1} of "${name}" must be ${typeToString(p)}, not ${typeToString(args[i].type!)}`, args[i].pos);
      }
    });
  }

  function binaryType(op: BinaryOp, l: VarType, r: VarType, pos: number): VarType {
    const fail = (): never => {
      throw new CompileError('E_TYPE_OPERATOR', `Cannot apply "${op}" to ${typeToString(l)} and ${typeToString(r)}`, pos);
    };
    const bothNum = isNum(l) && isNum(r);
    const widest = (): VarType => (isScalarOf(l, 'real') || isScalarOf(r, 'real') ? T.real : T.int);

    switch (op) {
      case '+':
        if (isScalarOf(l, 'string') || isScalarOf(r, 'string')) {
          if (l.kind !== 'scalar' || r.kind !== 'scalar') return fail();
          return T.string;
        }
        return bothNum ? widest() : fail();
      case '-':
      case '*':
      case '%':
      case '^':
        return bothNum ? widest() : fail();
      case '/':
        return bothNum ? T.real : fail();
      case 'div':
        return isScalarOf(l, 'int') && isScalarOf(r, 'int') ? T.int : fail();
      case '==':
      case '!=':
        if (bothNum) return T.bool;
        if (l.kind === 'scalar' && r.kind === 'scalar' && l.base === r.base) return T.bool;
        return fail();
      case '<':
      case '<=':
      case '>':
      case '>=':
        if (bothNum) return T.bool;
        if (isScalarOf(l, 'string') && isScalarOf(r, 'string')) return T.bool;
        return fail();
      case 'and':
      case 'or':
        return isScalarOf(l, 'bool') && isScalarOf(r, 'bool') ? T.bool : fail();
      default:
        return fail();
    }
  }
}

export function isValidName(name: string): boolean {
  return IDENTIFIER_RE.test(name) && !isReservedWord(name) && !RESERVED_NAMES.has(name);
}
