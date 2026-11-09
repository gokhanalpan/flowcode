import { ExprError } from './errors';

export type TokenKind =
  | 'num' | 'str' | 'ident' | 'bool' | 'op'
  | 'lparen' | 'rparen' | 'lbracket' | 'rbracket' | 'comma' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Canonical text: operators are normalized ('=' → '==', 've' → 'and', ...). */
  text: string;
  pos: number;
  value?: number | string | boolean;
  isInt?: boolean;
}

/** Word operators and literals. Turkish aliases map onto the same canonical tokens. */
const WORDS: Record<string, { kind: 'op' | 'bool'; text: string }> = {
  and: { kind: 'op', text: 'and' },
  ve: { kind: 'op', text: 'and' },
  or: { kind: 'op', text: 'or' },
  veya: { kind: 'op', text: 'or' },
  not: { kind: 'op', text: 'not' },
  'değil': { kind: 'op', text: 'not' },
  degil: { kind: 'op', text: 'not' },
  div: { kind: 'op', text: 'div' },
  mod: { kind: 'op', text: '%' },
  true: { kind: 'bool', text: 'true' },
  'doğru': { kind: 'bool', text: 'true' },
  dogru: { kind: 'bool', text: 'true' },
  false: { kind: 'bool', text: 'false' },
  'yanlış': { kind: 'bool', text: 'false' },
  yanlis: { kind: 'bool', text: 'false' },
};

/** Longest symbols first. [written form, canonical form] */
const SYMBOLS: Array<[string, string]> = [
  ['==', '=='], ['!=', '!='], ['<>', '!='], ['<=', '<='], ['>=', '>='], ['&&', 'and'], ['||', 'or'],
  ['<', '<'], ['>', '>'], ['=', '=='], ['+', '+'], ['-', '-'], ['*', '*'], ['/', '/'], ['%', '%'], ['^', '^'], ['!', 'not'],
];

const PUNCT: Record<string, TokenKind> = { '(': 'lparen', ')': 'rparen', '[': 'lbracket', ']': 'rbracket', ',': 'comma' };

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => /[\p{L}_]/u.test(c);
const isIdentPart = (c: string): boolean => /[\p{L}\p{N}_]/u.test(c);

export const IDENTIFIER_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** True if `name` is a word the expression language reserves (and/or/ve/veya/...). */
export const isReservedWord = (name: string): boolean => Object.prototype.hasOwnProperty.call(WORDS, name.toLowerCase());

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (isDigit(ch)) {
      let j = i;
      while (j < src.length && isDigit(src[j])) j++;
      let isInt = true;
      if (src[j] === '.' && j + 1 < src.length && isDigit(src[j + 1])) {
        isInt = false;
        j++;
        while (j < src.length && isDigit(src[j])) j++;
      }
      const text = src.slice(i, j);
      tokens.push({ kind: 'num', text, pos: i, value: Number(text), isInt });
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') {
          const e = src[j + 1];
          if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else if (e === '"') out += '"';
          else if (e === '\\') out += '\\';
          else throw new ExprError('E_BAD_ESCAPE', `Unknown escape "\\${e ?? ''}"`, j);
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= src.length) throw new ExprError('E_UNTERMINATED_STRING', 'Unterminated string', i);
      tokens.push({ kind: 'str', text: src.slice(i, j + 1), pos: i, value: out });
      i = j + 1;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j])) j++;
      const text = src.slice(i, j);
      const word = WORDS[text.toLowerCase()];
      if (word) {
        tokens.push({ kind: word.kind, text: word.text, pos: i, value: word.kind === 'bool' ? word.text === 'true' : undefined });
      } else {
        tokens.push({ kind: 'ident', text, pos: i });
      }
      i = j;
      continue;
    }

    const sym = SYMBOLS.find(([s]) => src.startsWith(s, i));
    if (sym) {
      tokens.push({ kind: 'op', text: sym[1], pos: i });
      i += sym[0].length;
      continue;
    }

    const punct = PUNCT[ch];
    if (punct) {
      tokens.push({ kind: punct, text: ch, pos: i });
      i++;
      continue;
    }

    throw new ExprError('E_UNEXPECTED_CHAR', `Unexpected character "${ch}"`, i);
  }

  tokens.push({ kind: 'eof', text: '', pos: src.length });
  return tokens;
}
