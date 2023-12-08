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
you can use the following steps to create a JS file using `browserify`.
We plan to make this process easier soon by uploading
the browser version of the library to a CDN.


If you don't have `browserify` please install it using the following command:
```bash
npm install -g browserify
```

We also need babel to transpile the code to ES5. Please install it using the following command (you can use `--save-dev` flag instead of `-g` if you don't want to install it globally):
```bash
npm install -g @babel/core @babel/cli @babel/preset-env
```

Then, we can use `browserify` to create a JS file that can be used in the browser:
```bash
browserify src/rhyme.js -o bundle.js -t [ babelify --presets [ @babel/preset-env ] --plugins [ @babel/plugin-transform-class-properties ] ] --s rhyme
```

This will create a file named `bundle.js` in the root directory of the repo.
You can then use this file in your HTML file as follows:
```html
<script src="/path/to/bundle.js"></script>
```

If you want to use the visualization features, you also need to include the `src/graphics.js` file in your HTML file:
```html
<script src="/path/to/rhyme/src/graphics.js"></script>
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

            <script src="/path/to/bundle.js"></script>
            <script src="/path/to/rhyme/src/graphics.js"></script>

            <script>
                let api = rhyme.api
                m.domParent = document.getElementById("root")
                let data = [{x:20,y:70},{x:40,y:30},{x:60,y:50},{x:80,y:60},{x:100,y:40}]
                let query = {
                    "$display": "select",
                    data: data
                }
                let res = api.query(query)
                display(res({}))
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
