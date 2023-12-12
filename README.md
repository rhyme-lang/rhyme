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
Currently the code is structured into four main javascript files:
- `src/rhyme.js`: Contains the main APIs that are exposed to the user.
- `src/ir.js`: Contains the logic for creating the Rhyme intermediate representation (IR) from input query ASTs.
- `src/codegen.js`: Contains the logic for generating optimized javascript code from the Rhyme IR.
- `src/parser.js`: Contains the logic for a preliminary parser that provides a simple
textual interface for writing certain Rhyme expressions.


### Running tests
`npm test` will run all the tests that are in the `test` directory.

If you're using VSCode, you can install [Jest Runner](https://marketplace.visualstudio.com/items?itemName=firsttris.vscode-jest-runner) extension and run/debug individual tests.


### Useful Links
- An upcoming publication on Rhyme (to appear at PADL 2024): [Rhyme: A Data-Centric Expressive Query Language for Nested Data Structures](https://www.cs.purdue.edu/homes/rompf/papers/abeysinghe-padl24.pdf)
- An interactive blog introducing Rhyme can be found [here](https://tiarkrompf.github.io/notes/?/js-queries/).