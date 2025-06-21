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

let outDir = "cgen-sql/out/"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  await sh(`cp cgen-sql/rhyme-sql.h ${outDir}`)
});

test("testTrivial", async () => {
  let query = rh`1 + 200`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testTrivial", schema: types.never })

  let res = await func()
  expect(res).toEqual("201\n")
})

let schema = typing.parseType`[{
  A: string,
  B: i32,
  C: i32,
  D: i32,
  String: string
}]!`;

test("testSimpleSum1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*A.C | sum`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testSimpleSum1", schema: types.never })

  let res = await func()
  expect(res).toEqual("228\n")
})

test("testSimpleSum2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`${csv}.*.C + 10 | sum`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testSimpleSum2", schema: types.never })

  let res = await func()
  expect(res).toEqual("268\n")
})

test("testSimpleSum3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`(${csv}.*.C | sum) + 10`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testSimpleSum3", schema: types.never })

  let res = await func()
  expect(res).toEqual("238\n")
})

test("testSimpleSum4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C) + sum(${csv}.*B.D)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testSimpleSum4", schema: types.never })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testSimpleSum5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*A.D)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testSimpleSum5", schema: types.never })

  let res = await func()
  expect(res).toEqual("243\n")
})

test("testLoadCSVMultipleFilesZip", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*A.D)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testLoadCSVMultipleFilesZip", schema: types.never })

  let res = await func()
  expect(res).toEqual("231\n")
})

test("testLoadCSVSingleFileJoin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`sum(${csv}.*A.C + ${csv}.*B.D)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testLoadCSVSingleFileJoin", schema: types.never })

  let res = await func()
  expect(res).toEqual("972\n")
})

test("testLoadCSVMultipleFilesJoin", async () => {
  let csv1 = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`
  let csv2 = rh`loadCSV "./cgen-sql/simple1.csv" ${schema}`

  let query = rh`sum(${csv1}.*A.C + ${csv2}.*B.D)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testLoadCSVMultipleFilesJoin", schema: types.never })

  let res = await func()
  expect(res).toEqual("924\n")
})

test("testMin", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`min ${csv}.*.B`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testMin", schema: types.never })

  let res = await func()
  expect(res).toEqual("1\n")
})

test("testMax", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`max ${csv}.*.C`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testMax", schema: types.never })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testCount", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`count ${csv}.*.C`
  
  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testCount", schema: types.never })

  let res = await func()
  expect(res).toEqual("4\n")
})

test("testStatefulPrint1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ${csv}.*.B`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testStatefulPrint1", schema: types.never })

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

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testStatefulPrint2", schema: types.never })

  let res = await func()
  expect(res).toEqual(`valA
valB
valC
valD
`
  )
})

test("testLoadCSVDynamicFilename", async () => {
  let files_schema = typing.parseType`[{ file: string }]!`

  let filenames = rh`(loadCSV "./cgen-sql/files.csv" ${files_schema}).*f.file`

  let csv = rh`loadCSV ${filenames} ${schema}`

  let query = rh`sum ${csv}.*A.D`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testLoadCSVDynamicFilename", schema: types.never })

  let res = await func()
  expect(res).toEqual("18\n")
})

test("testLoadCSVDynamicFilenameJoin", async () => {
  let files_schema = typing.parseType`[{ file: string }]!`

  let filenames = rh`(loadCSV "./cgen-sql/files.csv" ${files_schema}).*f.file`

  let csv = rh`loadCSV ${filenames} ${schema}`

  let query = rh`sum (${csv}.*A.D + ${csv}.*B.B)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testLoadCSVDynamicFilenameJoin", schema: types.never })

  let res = await func()
  expect(res).toEqual("192\n")
})

test("testConstStr", async () => {
  let query = rh`print "Hello, World!"`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testConstStr", schema: types.never })

  let res = await func()
  expect(res).toEqual("Hello, World!\n")
})

test("testFilter1", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C == 123) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testFilter1", schema: types.never })

  let res = await func()
  expect(res).toEqual("valB\n")
})

test("testFilter2", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.C != 123) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testFilter2", schema: types.never })

  let res = await func()
  expect(res).toEqual(`valA
valC
valD
`)
})

test("testFilter3", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valB") & ${csv}.*A.C)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testFilter3", schema: types.never })

  let res = await func()
  expect(res).toEqual("123\n")
})

test("testFilter4", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A == "valC") & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testFilter4", schema: types.never })

  let res = await func()
  expect(res).toEqual("valC\n")
})

test("testFilter5", async () => {
  let csv = rh`loadCSV "./cgen-sql/simple.csv" ${schema}`

  let query = rh`print ((${csv}.*A.A != ${csv}.*A.String) & ${csv}.*A.A)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testFilter5", schema: types.never })

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

let dataSchema = typing.parseType`[{
  key: string,
  value: i32
}]!`

let countrySchema = typing.parseType`[{
  country: string,
  city: string,
  population: u32
}]!`

let regionSchema = typing.parseType`[{
  region: string,
  country: string
}]!`

test("plainSumTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`sum ${csv}.*.value`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "plainSumTest", schema: types.never })

  let res = await func()
  expect(res).toBe("60\n")
})

test("plainAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "plainAverageTest", schema: types.never })

  let res = await func()
  expect(res).toBe("20.0000\n")
})

test("uncorrelatedAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`(sum ${csv}.*A.value) / (count ${csv}.*B.value)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "uncorrelatedAverageTest", schema: types.never })

  let res = await func()
  expect(res).toBe("20.0000\n")
})

test("groupByTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`{ key: ${csv}.*.key, sum: sum ${csv}.*.value } | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupByTest", schema: types.never })

  let res = await func()
  expect(res).toBe(`A|40|
B|20|
`)
})

test("groupByAverageTest", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let avg = rh`(sum ${csv}.*.value) / (count ${csv}.*.value)`

  let query = rh`{ key: ${csv}.*.key, avg: ${avg} } | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupByAverageTest", schema: types.never })

  let res = await func()
  expect(res).toBe(`A|20.0000|
B|20.0000|
`)
})

test("groupByRelativeSum", async () => {
  let csv = rh`loadCSV "./cgen-sql/data.csv" ${dataSchema}`

  let query = rh`{ key: ${csv}.*.key, precentage: (sum ${csv}.*.value) / (sum ${csv}.*B.value) } | group ${csv}.*.key`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupByRelativeSum", schema: types.never })

  let res = await func()
  expect(res).toBe(`A|0.6667|
B|0.3333|
`)
})

test("groupCountByPopulation", async () => {
  let csv = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`

  // test integer values as group key
  let query = rh`{ pop: ${csv}.*.population, count: count ${csv}.*.city } | group ${csv}.*.population`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupCountByPopulation", schema: types.never })

  let res = await func()
  expect(res).toBe(`30|1|
20|1|
10|2|
`)
})

test("groupRegionByCountry", async () => {
  let csv = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  // test strings as hashtable values
  let query = rh`{ country: ${csv}.*.country, region: ${csv}.*.region } | group ${csv}.*.country`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupRegionByCountry", schema: types.never })

  let res = await func()
  expect(res).toBe(`Japan|Asia|
China|Asia|
France|Europe|
UK|Europe|
`)
})

test("nestedLoopJoinSimpleTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let query = rh`{ city: ${country}.*.city, region: (${region}.*.country == ${country}.*.country) & ${region}.*.region } | group ${country}.*.city`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "nestedLoopJoinSimpleTest", schema: types.never })

  let res = await func()
  expect(res).toBe(`Tokyo|Asia|
Beijing|Asia|
Paris|Europe|
London|Europe|
`)
})

test("nestedLoopJoinWithAggrTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  // SELECT SUM(country.population) FROM country JOIN region ON region.country = country.country GROUP BY region.region
  let query = rh`{ region: ${region}.*.region, sum: sum ((${region}.*.country == ${country}.*.country) & ${country}.*.population) } | group ${region}.*.region`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "nestedLoopJoinWithAggrTest", schema: types.never })

  let res = await func()
  expect(res).toBe(`Asia|50|
Europe|20|
`)
})

test("hashJoinSimpleTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`{ city: ${country}.*.city, country: ${q1}.(${country}.*.country) } | group ${country}.*.city`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "hashJoinSimpleTest", schema: types.never })
  let res = await func()
  expect(res).toBe(`Tokyo|Asia|
Beijing|Asia|
Paris|Europe|
London|Europe|
`)
})

test("hashJoinWithAggrTest", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`{region: ${q1}.(${country}.*.country), sum: sum ${country}.*.population} | group ${q1}.(${country}.*.country)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "hashJoinWithAggrTest", schema: types.never })
  let res = await func()
  expect(res).toBe(`Asia|50|
Europe|20|
`)
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

  let query = rh`{ region: ${region}.*O.region, countries: array ${region}.*O.country} | group ${region}.*O.region`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "groupByArray", schema: types.never })
  let res = await func()

  expect(res).toBe(`Asia|[Japan, China]|
Europe|[France, UK]|
`)
})

test("hashJoinArray", async () => {
  let country = rh`loadCSV "./cgen-sql/country.csv" ${countrySchema}`
  let region = rh`loadCSV "./cgen-sql/region.csv" ${regionSchema}`

  let q1 = rh`${region}.*O.region | group ${region}.*O.country`
  let query = rh`{ region: ${q1}.(${country}.*.country), pops: array ${country}.*.population } | group ${q1}.(${country}.*.country)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "hashJoinArray", schema: types.never })
  let res = await func()

  expect(res).toBe(`Asia|[30, 20]|
Europe|[10, 10]|
`)
})

test("plainSumTBLTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`sum ${csv}.*.value`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "plainSumTBLTest", schema: types.never })

  let res = await func()
  expect(res).toBe("60\n")
})

test("arrayProjectionSingleTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[${csv}.*.value]`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "arrayProjectionSingleTest", schema: types.never })

  let res = await func()
  expect(res).toBe("[10, 20, 30]\n")
})

test("arrayProjectionSingleStringTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[${csv}.*.key]`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "arrayProjectionSingleStringTest", schema: types.never })

  let res = await func()
  expect(res).toBe("[A, B, A]\n")
})

test("arrayProjectionMultipleTest", async () => {
  let csv = rh`loadTBL "./cgen-sql/data.tbl" ${dataSchema}`

  let query = rh`[{ value: ${csv}.*.value, key: ${csv}.*.key }]`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "arrayProjectionMultipleTest", schema: types.never })

  let res = await func()
  expect(res).toBe(`10|A|
20|B|
30|A|
`)
})

/**/