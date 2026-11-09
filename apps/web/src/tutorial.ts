import type { Block, Expr, Program } from '@flowcode/core';
import { parseExpression } from '@flowcode/core';

/** What a tutorial step can look at to decide whether the learner has done it. */
export interface TutorialContext {
  program: Program;
  /** Completed runs of this chart (Play, Step or Run reaching the end). */
  finishedRuns: number;
  /** Runs that read at least one input. */
  runsWithInput: number;
  tab: 'run' | 'code';
}

export interface TutorialStep {
  /** i18n keys are `tut.<id>.title` and `tut.<id>.text`. */
  id: string;
  /** Absent → the step is informational and the learner presses Next. */
  check?: (ctx: TutorialContext) => boolean;
}

const outputs = (p: Program): Extract<Block, { kind: 'output' }>[] => p.main.filter((b): b is Extract<Block, { kind: 'output' }> => b.kind === 'output');
const stringVars = (p: Program): string[] => p.main.filter((b) => b.kind === 'declare' && b.type === 'string' && b.size === undefined).map((b) => (b as Extract<Block, { kind: 'declare' }>).name);

const tryParse = (text: string): Expr | null => {
  try {
    return parseExpression(text);
  } catch {
    return null;
  }
};

const mentionsVar = (e: Expr, names: string[]): boolean => {
  switch (e.kind) {
    case 'var': return names.includes(e.name);
    case 'binary': return mentionsVar(e.left, names) || mentionsVar(e.right, names);
    case 'unary': return mentionsVar(e.operand, names);
    case 'call': return e.args.some((a) => mentionsVar(a, names));
    default: return false;
  }
};
const hasStringLiteral = (e: Expr): boolean => {
  switch (e.kind) {
    case 'str': return e.value.length > 0;
    case 'binary': return hasStringLiteral(e.left) || hasStringLiteral(e.right);
    default: return false;
  }
};

/**
 * "Hello": say something, run it, then ask for a name and greet the person.
 * Every step except the first and last is checked against the chart or the runs,
 * so the learner is never told "well done" for something they haven't done.
 */
export const helloTutorial: TutorialStep[] = [
  { id: 'welcome' },
  { id: 'addSay', check: ({ program }) => outputs(program).length >= 1 },
  {
    id: 'sayText',
    check: ({ program }) => outputs(program).some((o) => {
      const e = tryParse(o.value);
      return e?.kind === 'str' && e.value.trim().length > 0;
    }),
  },
  { id: 'play1', check: ({ finishedRuns }) => finishedRuns >= 1 },
  { id: 'addVar', check: ({ program }) => stringVars(program).length >= 1 },
  { id: 'addAsk', check: ({ program }) => program.main.some((b) => b.kind === 'input' && stringVars(program).includes(b.target)) },
  {
    id: 'sayName',
    check: ({ program }) => outputs(program).some((o) => {
      const e = tryParse(o.value);
      return !!e && mentionsVar(e, stringVars(program)) && hasStringLiteral(e);
    }),
  },
  { id: 'play2', check: ({ runsWithInput }) => runsWithInput >= 1 },
  { id: 'code', check: ({ tab }) => tab === 'code' },
  { id: 'done' },
];
