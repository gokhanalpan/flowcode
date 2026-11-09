# FlowCode

A flowchart-to-code app for people learning algorithms: draw the chart, run it with a debugger,
and get the same program in JavaScript (free), TypeScript, Python or C# (paid), in English or Turkish.

```
packages/core   the engine: IR, expression language, checker, interpreter, generators, auto-layout — pure TypeScript, 100+ tests
apps/web        the app: React + Vite + Capacitor
```

```bash
npm install
npm test            # core tests (C# ones skip without a dotnet SDK)
npm run dev         # the app at http://localhost:5173
npm run build
npm run cli -- run packages/core/examples/guess.json
```

See `packages/core/README.md` for the engine and `apps/web/README.md` for the app.
