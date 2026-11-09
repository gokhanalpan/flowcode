/**
 * Every message has a stable `code` so the UI can localize it (en/tr) without
 * parsing English text. Messages here are the English fallback.
 */
export interface Diagnostic {
  code: string;
  message: string;
  /** Block the problem is in. */
  blockId?: string;
  /** Function the block belongs to; undefined for main. */
  fn?: string;
  /** Offset inside the block's expression text, when the problem is in an expression. */
  pos?: number;
}

export class ExprError extends Error {
  constructor(public readonly code: string, message: string, public readonly pos: number) {
    super(message);
    this.name = 'ExprError';
  }
}

export class CompileError extends Error {
  constructor(public readonly code: string, message: string, public readonly pos?: number) {
    super(message);
    this.name = 'CompileError';
  }
}

export interface RuntimeError {
  code: string;
  message: string;
  blockId?: string;
}
