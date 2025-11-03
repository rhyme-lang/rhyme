const { optimize } = require('webpack')
const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')

const os = require('child_process')

let sh = (cmd) => {
  return new Promise((resolve, reject) => {
    os.exec(cmd, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

let outDir = "cgen-sql/out/sql-new"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  // await sh(`cp cgen-sql/rhyme-c.h ${outDir}`)
});

test("testTrivial", async () => {
  let query = rh`1 + 200`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testTrivial", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(201)
})

let schema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    A: types.string,
    B: types.i32,
    C: types.i32,
    D: types.i32,
    String: types.string,
  })).build()

test("testScalar", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum ${csv}.*A.C`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testScalar", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(228)
})

test("testSimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*A.C | sum`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testSimpleSum1", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(228)
})

test("testSimpleSum2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C + 10 | sum`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testSimpleSum2", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(268)
})

test("testSimpleSum3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`(${csv}.*.C | sum) + 10`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testSimpleSum3", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(238)
})

test("testSimpleSum4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*B.D)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testSimpleSum4", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(243)
})

test("testSimpleSum5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*A.D)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testSimpleSum5", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(243)
})

test("testLoadCSVMultipleFilesZip", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*A.D)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadCSVMultipleFilesZip", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(231)
})

test("testLoadCSVSingleFileJoin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*B.D)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadCSVSingleFileJoin", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(972)
})

test("testLoadCSVMultipleFilesJoin", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*B.D)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadCSVMultipleFilesJoin", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(924)
})

test("testMin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`min ${csv}.*.B`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMin", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(1)
})

test("testMax", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`max ${csv}.*.C`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMax", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(123)
})

test("testCount", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`count ${csv}.*.C`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testCount", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(4)
})

test("testStatefulPrint1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ${csv}.*.B`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testStatefulPrint1", schema: types.never })

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

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testStatefulPrint2", schema: types.never })

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

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadCSVDynamicFilename", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(18)
})

test("testLoadCSVDynamicFilenameJoin", async () => {
  let files_schema = typing.objBuilder()
    .add(typing.createKey(types.u32), typing.createSimpleObject({
      file: types.string
    })).build()

  let filenames = rh`(loadCSV "./cgen-sql/files.csv" ${files_schema}).*f.file`

  let csv = rh`loadCSV ${filenames} ${schema}`

  let query = rh`sum (${csv}.*A.D + ${csv}.*B.B)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadCSVDynamicFilenameJoin", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(192)
})

test("testConstStr", async () => {
  let query = rh`print "Hello, World!"`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testConstStr", schema: types.never })

  let res = await func()
  expect(res).toEqual("Hello, World!\n")
})

test("testFilter1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C == 123) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFilter1", schema: types.never })

  let res = await func()
  expect(res).toEqual("valB\n")
})

test("testFilter2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C != 123) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFilter2", schema: types.never })

  let res = await func()
  expect(res).toEqual(`valA
valC
valD
`)
})

test("testFilter3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valB") & ${csv}.*A.C)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFilter3", schema: types.never })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testFilter4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valC") & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFilter4", schema: types.never })

  let res = await func()
  expect(res).toEqual("valC\n")
})

test("testFilter5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A != ${csv}.*A.String) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFilter5", schema: types.never })

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
    // region: types.string,
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

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainSumTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(60)
})

test("plainAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainAverageTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(20)
})

test("uncorrelatedAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*A.value) / (count ${csv}.*B.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "uncorrelatedAverageTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(20)
})

test("groupByTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`sum ${csv}.*.value | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ A: 40, B: 20 })
})

test("groupByAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let avg = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let query = rh`${avg} | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByAverageTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ A: 20, B: 20 })
})

test("undefinedTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let avg = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let query = rh`{ key: ${csv}.*.key, avg: ${avg} } | group ${csv}.*.key`

  let q = rh`${query}.C.avg`

  let func = await compile(q, { backend: "c-new", outDir, outFile: "undefinedTest", schema: types.never })

  let res = await func()
  expect(res).toBe("undefined")
})

test("groupByRelativeSum", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`((sum ${csv}.*.value) / (sum ${csv}.*B.value)) | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByRelativeSum", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ A: 0.6667, B: 0.3333 })
})

test("groupCountByPopulation", async () => {
  let csv = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`

  // test integer values as group key
  let query = rh`count ${csv}.*.city | group ${csv}.*.population`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupCountByPopulation", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ "30": 1, "20": 1, "10": 2 })
})

test("groupRegionByCountry", async () => {
  let csv = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  // test strings as hashtable values
  let query = rh`${csv}.*.region | group ${csv}.*.country`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupRegionByCountry", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ Japan: "Asia", China: "Asia", France: "Europe", UK: "Europe" })
})

test("nestedLoopJoinSimpleTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let query = rh`(${region}.*.country == ${country}.*.country) & ${region}.*.region | group ${country}.*.city`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "nestedLoopJoinSimpleTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ Tokyo: "Asia", Beijing: "Asia", Paris: "Europe", London: "Europe" })
})

test("nestedLoopJoinWithAggrTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  // SELECT SUM(country.population) FROM country JOIN region ON region.country = country.country GROUP BY region.region
  let query = rh`sum ((${region}.*.country == ${country}.*.country) & ${country}.*.population) | group ${region}.*.region`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "nestedLoopJoinWithAggrTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual({ Asia: 50, Europe: 20 })
})

test("hashJoinSimpleTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`${q1}.(${country}.*.country) | group ${country}.*.city`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "hashJoinSimpleTest", schema: types.never })
  let res = await func()
  expect(JSON.parse(res)).toEqual({ Tokyo: "Asia", Beijing: "Asia", Paris: "Europe", London: "Europe" })
})

test("hashJoinWithAggrTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`sum ${country}.*.population | group ${q1}.(${country}.*.country)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "hashJoinWithAggrTest", schema: types.never })
  let res = await func()
  expect(JSON.parse(res)).toEqual({ Asia: 50, Europe: 20 })
})

let countryData = [
  { country: "Japan", city: "Tokyo", population: 30 },
  { country: "China", city: "Beijing", population: 20 },
  { country: "France", city: "Paris", population: 10 },
  { country: "UK", city: "London", population: 10 },
]

let regionData = [
  { region: "Asia", country: "Japan" },
  { region: "Asia", country: "China" },
  { region: "Europe", country: "France" },
  { region: "Europe", country: "UK" },
]

test("groupByArray", async () => {
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let query = rh`array ${region}.*O.country | group ${region}.*O.region`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByArray", schema: types.never })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ Asia: ["Japan", "China"], Europe: ["France", "UK"] })
})

test("hashJoinArray", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`array ${country}.*.population | group ${q1}.(${country}.*.country)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "hashJoinArray", schema: types.never })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ Asia: [30, 20], Europe: [10, 10] })
})

test("plainSumTBLTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`sum ${csv}.*.value`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainSumTBLTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(60)
})

test("arrayProjectionSingleTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[${csv}.*.value]`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayProjectionSingleTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual([10, 20, 30])
})

test("arrayProjectionSingleStringTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[${csv}.*.key]`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayProjectionSingleStringTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual(["A", "B", "A"])
})

test("arrayProjectionMultipleTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[{ value: ${csv}.*.value, key: ${csv}.*.key }]`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayProjectionMultipleTest", schema: types.never })

  let res = await func()
  expect(JSON.parse(res)).toEqual([{ value: 10, key: "A" }, { value: 20, key: "B" }, { value: 30, key: "A" }])
})

test("arrayAccessUndefTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[{ value: ${csv}.*.value, key: ${csv}.*.key }].(1 + 10).key`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayAccessUndefTest", schema: types.never })

  let res = await func()
  // undefined is not a valid json string
  expect(res).toBe("undefined")
})

test("testArraySimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum [{C: ${csv}.*A.C}].*B.C`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testArraySimpleSum1", schema: types.never, enableOptimization: false })

  let res = await func()
  expect(JSON.parse(res)).toEqual(228)
})

test("testArraySorting", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sort [{C: ${csv}.*A.C}] "C" 0`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testArraySimpleSum1", schema: types.never, enableOptimization: false })

  let res = await func()
  expect(JSON.parse(res)).toEqual([{ C: 0 }, { C: 13 }, { C: 92 }, { C: 123 }])
})

/**/