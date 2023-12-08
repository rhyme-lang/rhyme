# Rhyme

![CI Tests](https://github.com/rhyme-lang/rhyme-private/actions/workflows/node.js.yml/badge.svg)

Rhyme is an expressive declarative query language designed for high-level data manipulation, with a primary focus on querying nested structures (e.g., JSON, Tensors, etc.) and producing nested structures as a result.

Rhyme is still at very early stages of development and therefore expect rough edges
and breaking changes.
However, we are actively working on it and would love to hear your feedback.


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

## Development
### Setup
Clone the repo and run `npm install` to install all the dependencies.

If you want to use the development version of the library you cloned in a different
project, you can run `npm link` in the root directory of the repo and then run
`npm link rhyme-lang` in your project directory.

### Code Structure
Currently the code is structured into four main javascript files:
- `src/rhyme.js`: Contains the main APIs that are exposed to the user.
- `src/ir.js`: Contains the logic for creating the Rhyme intermediate representation (IR) from input query ASTs.
- `src/codegen.js`: Contains the logic for generating optimized javascript code from the Rhyme IR.
- `src/parser.js`: Contains the logic for a preliminary parser that provides a simple
textual interface for writing certain Rhyme expressions.


### Running tests
`npm test` will run all the tests that are in the `test` directory.

If you're using VSCode, you can install [Jest Runner](https://marketplace.visualstudio.com/items?itemName=firsttris.vscode-jest-runner) extension and run/debug individual tests.
