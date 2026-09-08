# Rhyme

![CI Tests](https://github.com/rhyme-lang/rhyme/actions/workflows/node.js.yml/badge.svg)

Rhyme is an expressive declarative query language designed for high-level data manipulation, with a primary focus on querying nested structures (e.g., JSON, Tensors, etc.) and producing nested structures as a result.

Rhyme is still at very early stages of development and therefore expect rough edges
and breaking changes.
However, we are actively working on it and would love to hear your feedback.

Checkout our website [rhyme-lang.github.io](https://rhyme-lang.github.io/) for more information.


## Getting Started
To get started with the latest release of Rhyme in your node project,
run the following command:

```bash
npm install rhyme-lang
```

You can then import the library (as you would any other node module) and start using it:

```javascript
const { api } = require('rhyme-lang')

let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

let query = {
    total: api.sum("data.*.value"),
    "data.*.key": api.sum("data.*.value"),
}
let res = api.compile(query)({ data })
console.log("Result: " + JSON.stringify(res))
```

Visit [documentation](https://rhyme-lang.github.io/docs/) to get a glimpse of what Rhyme can do.

## Using in the browser/frontend
Npm package `rhyme-lang` installed using above command is intended for use in nodejs projects.
However, if you want to use Rhyme in the browser (especially the visualization features),
you can use `unpkg` CDN to get the browser version of the library.
Specifically, you can include the script from the following URL in your HTML file:
```
https://unpkg.com/rhyme-lang/umd/rhyme-lang.min.js
```


Shown below is a simple complete example HTML file:
```html
<!DOCTYPE html>
<html>
    <head>
        <title>Rhyme Example</title>
        <meta charset="UTF-8">
    </head>
        <body>
            <h1>Rhyme Example</h1>
            <div id="root"></div>

            <script src="https://unpkg.com/rhyme-lang/umd/rhyme-lang.min.js"></script>

            <script>
                let api = rhyme.api
                let domParent = document.getElementById("root")
                let data = [{x:20,y:70},{x:40,y:30},{x:60,y:50},{x:80,y:60},{x:100,y:40}]
                let query = {
                    "$display": "select",
                    data: data
                }
                let res = api.query(query)
                api.display(res({}), domParent)
            </script>
        </body>
</html>
```

## Using as command-line tool

You can also use Rhyme as a command-line tool to process JSON files. For this, install rhyme globally:

```bash
npm install -g rhyme-lang
```

Then you can use it as follows:

```bash
echo '[1,2,3,4]' | rhyme 'sum stdin.*'
10
```

When given an argument ending in `.rh`, as in `rhyme query.rh`, Rhyme will treat it as a file name to load the query from.


## Development
### Setup
Clone the repo and run `npm install` to install all the dependencies.

If you want to use the development version of the library you cloned in a different
project, you can run `npm link` in the root directory of the repo and then run
`npm link rhyme-lang` in your project directory.

### Setup for running on browser
If you want to use the development version of the library in the browser, you can use
webpack to build the browser version of the library.
Use the following commands.

```bash
npm install webpack webpack-cli --save-dev
./node_modules/.bin/webpack
```

This will generate a file `umd/rhyme-lang.min.js` that you can include in your HTML file.

### Code Structure
A Rhyme query is parsed into an AST, lowered to an intermediate
representation (IR), analyzed, and then turned into generated JavaScript (or C/CUDA)
code that is compiled and run against the input data.

**Frontend** — query text or JS objects to stratified IR:
- `src/parser.js`: lexer and parser for the textual syntax, including the `` rh`...` ``
  tagged-template quasiquote.
- `src/desugar.js`: resolves paths, implicit arguments/holes and partial application
  into a canonical AST.
- `src/preprocess.js`: converts the AST into the stratified IR the rest of the
  compiler works on (`const`, `input`, `var`, `get`, `pure`, `stateful`, `update`, ...).
- `src/shared.js`: the table of built-in operations, shared by every stage, plus set
  utilities.

**Middle tier** — dependency analysis and optimization:
- `src/simple-eval.js`: the main compiler driver. Infers the dimensions, bound and
  free variables of every subterm to a fixpoint, extracts assignments and filters,
  and computes a legal execution order for them.
- `src/typing.js`: the type and schema system; also validates the IR and annotates it
  with types.
- `src/optimizer.js`: IR-level optimizations (common subexpression elimination, loop
  consolidation, shrinking).
- `src/scc.js`, `src/prettyprint.js`, `src/utils.js`: supporting utilities — cycle
  detection for recursive queries, IR pretty-printing used by `explain`.

**Backends** — the IR is handed to one of several code generators, selected by the
`backend` and `newCodegen` settings. The accepted `backend` names are listed in the
`backends` table in `src/shared.js` — `js` (default), `c`, `cuda`, `cpp`, `c-old` —
and an unknown name is rejected rather than silently treated as `js`:
- `src/simple-codegen.js`, `src/simple-loopgen.js`: generate JavaScript (the default).
  The generated code is evaluated with `src/simple-runtime.js` in scope, which
  implements the built-in operations at runtime.
- `src/new-codegen.js`: a loop-scheduling code generator that emits each assignment
  exactly once and fuses loops where possible. Used both for the JavaScript backend
  (`newCodegen: true`) and by the C backend.
- `src/cgen/`: the C and CUDA backend. Emits a C file, compiles it with `gcc`/`nvcc`
  against the runtime header in `runtime/`, and runs the resulting binary. This is the
  backend described in the VLDB paper linked below.
- `src/c1-ir.js`, `src/c1-codegen.js`: the original ("c1") pipeline. It is superseded
  by `simple-eval.js`, and is kept because `api.compile` still cross-checks against it.

**Entry points:**
- `src/rhyme.js`: the main APIs exposed to the user — the syntax API (`api.sum`,
  `api.get`, ...), the compilation API (`api.compile`, `api.compileC2`, ...), and
  `api.display`.
- `src/cli.js`: the `rhyme` command-line tool.
- `src/shell.js`: an interactive REPL (`npm run shell`) that keeps data across queries.
- `src/graphics.js`: the browser visualization layer behind `api.display` and
  `$display`; this is what the webpack browser build is mainly for.

**Other directories:**
- `test/`: the test suite (see below).
- `data/`: JSON and CSV inputs used by the tests.
- `runtime/`: `rhyme-c.h`, the C runtime header included by generated C code.
- `demos/`: standalone HTML demos of the visualization features.
- `third-party/`: vendored dependencies for the C/C++ backends (yyjson, nlohmann/json).


### Running tests
`npm test` will run all the tests that are in the `test` directory.

The tests are grouped as follows:
- `test/original/`, `test/semantics/`: language and compiler semantics — the former
  goes through `api.compile`, the latter calls `simple-eval` directly.
- `test/typing/`: the type system.
- `test/cgen/`: the C backend. These compile generated C with `gcc` and run it, so
  they need a working C toolchain.
- `test/aoc/`: Advent of Code solutions written in Rhyme, used as larger end-to-end
  tests.
- `test/tpch/`, `test/json-bench/`: benchmark-derived suites. They need datasets that
  are not in the repository and skip themselves when the data is absent.

If you're using VSCode, you can install [Jest Runner](https://marketplace.visualstudio.com/items?itemName=firsttris.vscode-jest-runner) extension and run/debug individual tests.


### Useful Links
- Paper published at VLDB (Jul 2026):
  [Rhyme Native: Efficient Code Generation for Structured and Semi-Structured Workloads](https://www.vldb.org/pvldb/vol19/p3676-guo.pdf)

- Paper published at FLOPS (Jun 2024):
  [Rhyme: A Data-Centric Multi-Paradigm Query Language based on Functional Logic Metaprogramming](https://www.cs.purdue.edu/homes/rompf/papers/abeysinghe-preprint2401.pdf)

- Paper published at PADL (Jan 2024):
  [Rhyme: A Data-Centric Expressive Query Language for Nested Data Structures](https://www.cs.purdue.edu/homes/rompf/papers/abeysinghe-padl24.pdf)

- An interactive blog post introducing an early version of Rhyme:
  [Let's build a Query Language!](https://tiarkrompf.github.io/notes/?/js-queries/)
