const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')
const { preproc } = require('../../src/preprocess')
const { typing } = require('../../src/typing')

const fs = require('node:fs/promises')
const os = require('node:child_process')

let execPromise = function (cmd) {
  return new Promise(function (resolve, reject) {
    os.exec(cmd, function (err, stdout) {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}


test("testRoundtrip0", async () => {
  let content = `#include <stdio.h>
int main() {
  puts("Hello C!");

  return 0;
}
`
  await execPromise('mkdir -p out')

  await fs.writeFile('out/sql.c', content);
  await execPromise('gcc out/sql.c -o out/sql')
  let res = await execPromise('out/sql')

  expect(res).toEqual("Hello C!\n")
})


test("testTrivial", async () => {
  let query = rh`1 + 200`

  let func = compile(query, { backend: "c-sql" })

  let res = await func()
  expect(res).toEqual("201\n")
})

let schema = {
  [Symbol("*A")]: {
    A: typing.string,
    B: typing.number,
    C: typing.number,
    D: typing.number
  }
}

test("testSimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C | sum`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing, csvSchema: ["A", "B", "C", "D"] })
  
  let res = await func()
  expect(res).toEqual("228\n")
})

test("testSimpleSum2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C + 10 | sum`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing })

  let res = await func()
  expect(res).toEqual("268\n")
})

test("testSimpleSum3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`(${csv}.*.C | sum) + 10`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing })

  let res = await func()
  expect(res).toEqual("238\n")
})

test("testSimpleSum4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*B.D)`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testSimpleSum5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*A.D)`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing })

  console.log(func.explain.code)

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testLoadCSVMultipleFiles", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple_copy.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C) + sum(${csv2}.*B.D)`

  let func = compile(query, { backend: "c-sql", schema: typing.nothing })

  let res = await func()
  expect(res).toEqual("231\n")
})

