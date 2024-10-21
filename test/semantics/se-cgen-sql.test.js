const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')
const { preproc } = require('../../src/preprocess')
const { typing, types } = require('../../src/typing')

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

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("201\n")
})

let schema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    A: types.string,
    B: types.i32,
    C: types.i32,
    D: types.i32
  })).build()

test("testSimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C | sum`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("228\n")
})

test("testSimpleSum2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C + 10 | sum`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("268\n")
})

test("testSimpleSum3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`(${csv}.*.C | sum) + 10`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("238\n")
})

test("testSimpleSum4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*B.D)`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testSimpleSum5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*A.D)`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testLoadCSVMultipleFilesZip", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple_copy.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*A.D)`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("231\n")
})

test("testLoadCSVMultipleFilesJoin", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple_copy.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*B.D)`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("924\n")
})

test("testMin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`min ${csv}.*.B`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("1\n")
})

test("testMax", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`max ${csv}.*.C`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testCount", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`count ${csv}.*.C`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("4\n")
})

test("testStatefulPrint", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ${csv}.*.B`

  let func = compile(query, { backend: "c-sql", schema: types.nothing })

  let res = await func()
  expect(res).toEqual(`5
2
1
7
`
  )
})
