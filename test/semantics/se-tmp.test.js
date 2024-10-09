const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')

test("tmp", () => {
  let query = rh`data.*A | sum(.value) + sum(.value2)`

  let func = compile(query)

  console.log(func.explain.code)
})