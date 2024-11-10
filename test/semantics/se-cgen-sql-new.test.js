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

test("testTrivial", async () => {
  let query = rh`1 + 200`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("201\n")
})

let schema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    A: types.string,
    B: types.i32,
    C: types.i32,
    D: types.i32,
    String: types.string,
  })).build()

test("testSimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*A.C | sum`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("228\n")
})

test("testSimpleSum2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C + 10 | sum`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("268\n")
})

test("testSimpleSum3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`(${csv}.*.C | sum) + 10`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("238\n")
})

test("testSimpleSum4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*B.D)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testSimpleSum5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*A.D)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testLoadCSVMultipleFilesZip", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*A.D)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("231\n")
})

test("testLoadCSVSingleFileJoin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*B.D)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("972\n")
})

test("testLoadCSVMultipleFilesJoin", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*B.D)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("924\n")
})

test("testMin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`min ${csv}.*.B`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("1\n")
})

test("testMax", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`max ${csv}.*.C`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testCount", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`count ${csv}.*.C`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("4\n")
})

test("testStatefulPrint1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ${csv}.*.B`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual(`5
2
1
7
`
  )
})

test("testStatefulPrint2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ${csv}.*.A`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual(`valA
valB
valC
valD
`
  )
})

test("testLoadCSVDynamicFilename", async () => {
  let files_schema = typing.objBuilder()
    .add(typing.createKey(types.u32), typing.createSimpleObject({
      file: types.string
    })).build()

  let filenames = rh`(loadCSV "./cgen-sql/files.csv" ${files_schema}).*f.file`

  let csv = rh`loadCSV ${filenames} ${schema}`

  let query = rh`sum ${csv}.*A.D`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("18\n")
})

test("testLoadCSVDynamicFilenameJoin", async () => {
  let files_schema = typing.objBuilder()
    .add(typing.createKey(types.u32), typing.createSimpleObject({
      file: types.string
    })).build()

  let filenames = rh`(loadCSV "./cgen-sql/files.csv" ${files_schema}).*f.file`

  let csv = rh`loadCSV ${filenames} ${schema}`

  let query = rh`sum (${csv}.*A.D + ${csv}.*B.B)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("192\n")
})

test("testConstStr", async () => {
  let query = rh`print "Hello, World!"`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("Hello, World!\n")
})

test("testFilter1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C == 123) & ${csv}.*A.A)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("valB\n")
})

test("testFilter2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C != 123) & ${csv}.*A.A)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual(`valA
valC
valD
`)
})

test("testFilter3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valB") & ${csv}.*A.C)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testFilter4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valC") & ${csv}.*A.A)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual("valC\n")
})

test("testFilter5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A != ${csv}.*A.String) & ${csv}.*A.A)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toEqual(`valA
valB
valC
`)
})

let simple = [
  { A: "valA", B: 5, C: 13, D: 1, String: "string1" },
  { A: "valB", B: 2, C: 123, D: 2, String: "string2" },
  { A: "valC", B: 1, C: 92, D: 0, String: "string3" },
  { A: "valD", B: 7, C: 0, D: 12, String: "valD" },
]

test("testGroupByJS", () => {
  let inputSchema = typing.createSimpleObject({
    data: schema
  })
  let query = rh`sum data.*A.C | group data.*A.A`

  let func = compile(query, { newCodegen: true, schema: inputSchema })
  // console.log(func.explain.code)

  let res = func({ data: simple })
  // console.log(res)
})

let dataSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    key: types.string,
    value: types.i32
  })).build()

let countrySchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    region: types.string,
    country: types.string,
    city: types.string,
    population: types.u32
  })).build()

let regionSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    region: types.string,
    country: types.string
  })).build()

test("plainSumTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`sum ${csv}.*.value`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe("60\n")
})

test("plainAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe("20.000\n")
})

test("uncorrelatedAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*A.value) / (count ${csv}.*B.value)`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe("20.000\n")
})

test("groupByTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`sum ${csv}.*.value | group ${csv}.*.key`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe(`A: 40
B: 20
`)
})

test("groupByAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let avg = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let query = rh`${avg} | group ${csv}.*.key`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe(`A: 20.000
B: 20.000
`)
})

test("groupByRelativeSum", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*.value) / (sum ${csv}.*B.value) | group ${csv}.*.key`

  let func = compile(query, { backend: "c-sql-new", schema: types.nothing })

  let res = await func()
  expect(res).toBe(`A: 0.667
B: 0.333
`)
})
