#!/usr/bin/env node
/**
 * Dev CLI:
 *   npm run cli -- run examples/guess.json          interactive run in the interpreter
 *   npm run cli -- gen examples/guess.json [--lang python] [--browser]   print generated code
 *   npm run cli -- check examples/guess.json         print diagnostics
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { compile, generate, Runner, type LanguageId, type Program } from './index';

const [command, file, ...flags] = process.argv.slice(2);

if (!command || !file) {
  console.error('usage: flowcode <run|gen|check> <chart.json> [--lang js|typescript|python|csharp] [--browser]');
  process.exit(2);
}

const program = JSON.parse(readFileSync(file, 'utf8')) as Program;
const result = compile(program);

if (!result.ok) {
  for (const d of result.diagnostics) {
    const where = [d.fn ? `fn ${d.fn}` : 'main', d.blockId ? `block ${d.blockId}` : null].filter(Boolean).join(', ');
    console.error(`${d.code} (${where}): ${d.message}`);
  }
  process.exit(1);
}

if (command === 'check') {
  console.log('OK');
} else if (command === 'gen') {
  const langIndex = flags.indexOf('--lang');
  const language = (langIndex >= 0 ? flags[langIndex + 1] : 'js') as LanguageId;
  process.stdout.write(generate(result.program, language, { runtime: flags.includes('--browser') ? 'browser' : 'node' }));
} else if (command === 'run') {
  const runner = new Runner(result.program);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let printedLines = 0;
  let printedPartial = 0;

  const flush = (): void => {
    for (; printedLines < runner.output.length; printedLines++) {
      process.stdout.write(runner.output[printedLines].slice(printedPartial) + '\n');
      printedPartial = 0;
    }
    if (runner.partialLine.length > printedPartial) {
      process.stdout.write(runner.partialLine.slice(printedPartial));
      printedPartial = runner.partialLine.length;
    }
  };

  const tick = (): void => {
    const status = runner.run();
    flush();
    if (status === 'waitingInput') {
      rl.question('', (line) => {
        runner.provideInput(line);
        tick();
      });
      return;
    }
    rl.close();
    if (status === 'error') {
      console.error(`\nRuntime error ${runner.error!.code} at block ${runner.error!.blockId}: ${runner.error!.message}`);
      process.exit(1);
    }
    if (status === 'paused') console.error(`\nStopped: ${runner.pauseReason}`);
  };

  tick();
} else {
  console.error(`unknown command "${command}"`);
  process.exit(2);
}
