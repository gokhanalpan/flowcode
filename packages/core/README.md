# @flowcode/core

The engine behind FlowCode: a flowchart is the program, and everything else — running, debugging, every target language — is a function of one typed intermediate representation (IR). Pure TypeScript, zero UI dependencies, runs in a browser, a WebView, or Node.

```
src/
  ir.ts          Program / Block types (generic over expression representation)
  lexer.ts       Expression tokens; Turkish word aliases (ve, veya, değil, doğru, yanlış, mod)
  parser.ts      Expression text → AST
  builtins.ts    len, abs, sqrt, floor, ceil, round, min, max, pow, toInt, toReal, toString, upper, lower
  checker.ts     Scopes, static types, diagnostics with stable codes (E_UNDECLARED, E_TYPE_ASSIGN, …)
  bytecode.ts    Typed IR → flat stack-machine code (jumps instead of nesting, so the VM can pause anywhere)
  runner.ts      The VM: run / step / breakpoints / pause for input / variable watch / call stack
  generators/    js.ts (Node + browser; also the walker TypeScript reuses), typescript.ts, python.ts, csharp.ts. C++ to follow.
  cli.ts         Dev CLI
examples/        Charts (.json), scripted input (.in), expected output (.out)
test/            Parser, checker, runner, and the examples diff test
```

## Run it

```bash
npm install
npm test                                     # 81 tests (C# ones skip without a dotnet SDK)
npm run cli -- run examples/guess.json       # interactive run in the interpreter
npm run cli -- gen examples/gcd.json         # print generated JavaScript (--browser for prompt()/console.log)
npm run cli -- gen examples/gcd.json --lang python      # or typescript, csharp
npm run cli -- check examples/sum.json       # diagnostics only
```

`test/examples.test.ts` is the one that matters: every chart in `examples/` is run through the interpreter **and** through real Node on the generated JavaScript **and** through `python3` on the generated Python, all with the same input, and everything must match the `.out` file. `test/typescript.test.ts` does the same for TypeScript, and additionally type-checks every generated program (both runtimes) with `tsc --strict` in one pass before running it. `test/csharp.test.ts` wraps each generated program in its own namespace, builds all of them in one `dotnet build` with warnings as errors, and runs each through a reflection dispatcher; it skips when no `dotnet` SDK is installed. Drop a new `.json` (+ `.in`/`.out`) in and it's picked up. `examples/semantics.json` exists purely to pin the places where languages disagree by default (remainder sign, truncating division, rounding, float printing, operator precedence); every new generator has to pass it.

## API

```ts
import { compile, Runner, generate, parseExpression, LANGUAGES } from '@flowcode/core';

const result = compile(chart);               // chart: Program (plain JSON from the editor)
if (!result.ok) showErrors(result.diagnostics); // { code, message, blockId, fn?, pos? }

const r = new Runner(result.program);
r.breakpoints.add('b7');
r.run();                                     // → 'waitingInput' | 'paused' | 'finished' | 'error'
r.provideInput('42'); r.run();               // feed an Input block
r.step();                                    // execute one block
r.currentBlockId; r.variables(); r.callStack; r.output; r.partialLine; r.error; r.pauseReason;

generate(result.program, 'js', { runtime: 'node' | 'browser' });
generate(result.program, 'python');
generate(result.program, 'typescript', { runtime: 'node' | 'browser' });
generate(result.program, 'csharp');
parseExpression(text);                       // for live validation in the block editor; throws ExprError { code, pos }
LANGUAGES;                                   // [{ id, name, extension, free, implemented }]
```

`run()` takes a step budget (default 1,000,000) and returns `'paused'` with `pauseReason: 'budget'` instead of hanging on an infinite loop. Call `run()` again to continue.

## The IR

Structured, no free arrows. Compound blocks own their children, so every chart maps 1:1 onto `if`/`while`/`for` in any target.

| kind | fields |
|---|---|
| `declare` | `name`, `type` (`int` `real` `string` `bool`), optional `size` → array |
| `assign` | `target`, optional `index`, `value` |
| `input` | `target`, optional `index` |
| `output` | `value`, `newline` (default true) |
| `if` | `condition`, `then[]`, `else[]` |
| `while` | `condition`, `body[]` |
| `doWhile` | `body[]`, `condition` |
| `for` | `variable` (declared int), `from`, `to` (inclusive), `step` (integer literal, default 1), `body[]` |
| `call` | `name`, `args[]` — user functions only |
| `return` | optional `value` |
| `break`, `comment` | |

A `Program` is `{ version: 1, name?, main: Block[], functions: FunctionDef[] }`. Functions have typed params (arrays pass by reference), an optional return type, and recursion works. Expressions are stored as the text the user typed; the checker parses them.

Scoping is lexical (a variable declared inside an `if` is not visible after it) and shadowing is rejected. That is what lets each generator emit `let x = 0;` / `int x = 0;` exactly where the Declare block sits, with no hoisting or renaming. Names that are keywords in any target language are rejected at check time for the same reason.

## Expression language

```
or | and | not | == != < <= > >= | + - | * / % div | unary - | ^ (right-assoc) | call, index
```

- `=` and `<>` are accepted for `==` and `!=`; `&&` `||` `!` work too.
- Turkish: `ve` `veya` `değil` `doğru` `yanlış` `mod`.
- `/` is always real division; `div` is integer division; `^` is power.
- `+` with a string on either side concatenates (numbers/booleans are formatted).
- `int` promotes to `real` implicitly; nothing else converts. `7 / 2` is real, so assigning it to an `int` is a compile error — use `7 div 2`.

## Output formatting contract

The interpreter and every generated program must print values identically or the diff tests fail. The reference is JavaScript's `String(x)`: `5`, `2.5`, `true`, `3` for a real that happens to be integral, `0.00001`, `1e-7`, `1e+21`. Ints and strings already print the same everywhere; reals and booleans are where languages differ.

### How the Python generator handles it

The generator emits a small prelude only when the program needs it:

| FlowCode | Python | why |
|---|---|---|
| output / `+` of a real or bool | `fmt(x)` | `5.0`→`5`, `True`→`true`; matches JS `String()` exactly, including exponent forms |
| `a % b` | `mod(a, b)` | Python's `%` takes the sign of the divisor; JS/C#/C++ and the interpreter take the dividend's |
| `a div b` | `int(a / b)` | Python's `//` floors; `div` truncates toward zero |
| `round(x)` | `math.floor(x + 0.5)` | Python's `round()` is banker's rounding |
| `a ^ b` | `a ** b` | same precedence and associativity |
| do-while | `while True: … if <negated cond>: break` | |
| `for i = a to b` | `for i in range(a, b + 1)` | see below |

Two Python-specific caveats, both documented rather than worked around because the idiomatic code is what students should see:

- `range()` evaluates the end once; the interpreter re-evaluates `to` every iteration. They differ only if the loop body changes a variable used in `to`.
- After a For loop the loop variable is `last` in Python and `last + step` in JS/C#/C++. Charts shouldn't rely on the loop variable after the loop. (A checker warning for this is a good next step.)
- Invalid input to an Input block: the interpreter stops with `E_INPUT_INVALID`, Python raises `ValueError`, JS yields `NaN`. The behaviour on *valid* input is identical.

### TypeScript

Same walker as JavaScript, so the semantics are identical by construction; it only adds `number` / `string` / `boolean` / `T[]` annotations, typed helper signatures, `import { readFileSync } from "node:fs"` for the Node runtime, and `export {}` when there is no import so the file is a module rather than a global-scope script. One thing TypeScript catches that the other generators can't: a value-returning function whose end is reachable (a `return` only inside a loop, say) fails `tsc` with TS2366. The interpreter reports the same situation at runtime as `E_NO_RETURN`; a checker diagnostic for it would move that to edit time for every language.

### C#

Types map directly (`int`, `double`, `string`, `bool`, `T[]`), so most of the work is culture: on a Turkish Windows, `2.5.ToString()` is `"2,5"` and `"i".ToUpper()` is `"İ"`. Everything culture-sensitive goes through `CultureInfo.InvariantCulture` or the invariant method variants.

| FlowCode | C# | why |
|---|---|---|
| output / `+` of a real or bool | `Fmt(x)` | `double.ToString("R")` is shortest round-trip but writes `1E-05`; `Fmt` matches the contract exactly (`0.00001`, `1e-7`, `1e+21`) |
| `a / b` with int operands | `7.0 / 2` or `(double)a / b` | C# `int / int` truncates |
| `a div b` | `a / b` | already truncates toward zero |
| `a % b` | `a % b` | already dividend-signed |
| `round(x)` | `(int)Math.Floor(x + 0.5)` | `Math.Round` is banker's rounding |
| `floor` / `ceil` | `(int)Math.Floor` / `(int)Math.Ceiling` | they return `double` |
| `a ^ b` | `(int)Math.Pow(a, b)` or `Math.Pow(a, b)` | cast only when the chart typed the result as int |
| `s1 < s2` | `string.CompareOrdinal(s1, s2) < 0` | C# has no `<` on strings; ordinal matches JS |
| `upper` / `lower` | `ToUpperInvariant()` / `ToLowerInvariant()` | culture |
| input real | `double.Parse(Console.ReadLine() ?? "", CultureInfo.InvariantCulture)` | culture, and nullable-safe |
| string array | `new string[n]; Array.Fill(a, "")` | elements default to `null`, the chart says `""` |

If any string literal contains non-ASCII text, `Main` starts with `Console.OutputEncoding = new UTF8Encoding(false)` so "Dünya" survives the Windows console. `int` is 32-bit in C# while the interpreter uses doubles (exact to 2^53); charts that overflow `int` diverge, which is a checker warning for later.

### Still to handle in C++

- `cout` prints doubles with 6 significant digits; a `fmt` helper on top of `std::to_chars` (C++17) gives shortest round-trip, then apply the same normalisation as the C# one.
- `std::string` comparison is already ordinal; `toupper` is per-char and ASCII-only, so `ünlü` needs care (or document it).
- Input: `std::getline` + `std::stoi` / `std::stod`; `stod` is locale-dependent in principle but the "C" locale is the default.
- Arrays: `std::vector<T>(n)` value-initialises, so no fill step is needed.

## Adding a language

1. `src/generators/<lang>.ts`: walk `compiled.typed` (the typed IR). Every `Expr` node has `.type`, so you know when to cast, convert, or concatenate.
2. Register it in `generators/index.ts` and flip `implemented: true`.
3. Extend `test/examples.test.ts` to run the output through the real toolchain.

C++ is the last one; `examples/semantics.json` pins everything it has to get right.
