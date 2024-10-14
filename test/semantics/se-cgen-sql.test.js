const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')
const { preproc } = require('../../src/preprocess')

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
  let schema = ["A", "B", "C", "D"]

  let query = rh`1 + 200`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("201\n")
})

test("testSimpleSum1", async () => {
  let schema = ["A", "B", "C", "D"]

  let query = rh`sum .*.C`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("228\n")
})

test("testSimpleSum2", async () => {
  let schema = ["A", "B", "C", "D"]

  let query = rh`sum(.*.C + 10)`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("268\n")
})

test("testSimpleSum3", async () => {
  let schema = ["A", "B", "C", "D"]

  let query = rh`sum(.*.C) + 10`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("238\n")
})

test("testSimpleSum4", async () => {
  let schema = ["A", "B", "C", "D"]

  let query = rh`sum(.*A.C) + sum(.*B.B)`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("243\n")
})

test("testSimpleSum5", async () => {
  let schema = ["A", "B", "C", "D"]

  let query = rh`sum(.*A.C + .*A.B)`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/simple.csv")
  expect(res).toEqual("243\n")
})

test("testLoadCSV", () => {
  let schema = {
    [Symbol("*A")]: {
      A: typing.string,
      B: typing.number,
      C: typing.number,
      D: typing.number
    }
  }

  let query = preproc(rh`loadCSV "simple.csv" ${schema}`)
  
  // expect(query).toStrictEqual(
  // 	{
  //     key: 'csv',
  //     file: 'simple.csv',
  //     schema: [{ A: 'int32', B: 'int32' }]
  //   }
  // )
})
