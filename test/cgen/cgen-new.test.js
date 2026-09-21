// The c-new backend, checked against the js backend.
//
// Every query runs on both and the results must agree. The js backend is the
// reference semantics (src/simple-runtime.js), so this is a differential test
// rather than a set of hand-written expectations -- which also means it keeps
// working when a query's meaning is deliberately changed.
//
// Inputs are named by the query with loadJSON, exactly as in cgen-semantics,
// so the generated program opens the files itself. The difference from that
// suite is the schema: everything here is types.unknown, because c-new is the
// general-JSON path. mixed.json in particular (mixed value types, a missing
// key, a json null) is a shape the schema-bound "c" backend cannot express.
//
// One query per test, matching the other cgen suites. Each one compiles and
// runs a C program, and on macOS the first execution of a freshly built binary
// costs more than the compile does, so a test holding several queries adds up
// fast.

const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { types } = require('../../src/typing')

const fs = require('fs/promises')

let outDir = "out/cnew"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

let data = rh`loadJSON "./data/json/semantics/data.json" ${types.unknown}`
let other = rh`loadJSON "./data/json/semantics/other.json" ${types.unknown}`
let nested = rh`loadJSON "./data/json/semantics/nested.json" ${types.unknown}`
let mixed = rh`loadJSON "./data/json/semantics/mixed.json" ${types.unknown}`
let arrays = rh`loadJSON "./data/json/semantics/arrays.json" ${types.unknown}`

// Compile the query on both backends and assert the results agree. outFile is
// the test name, as in the other cgen suites, so a generated program can be
// traced back to the test that produced it.
let same = async (name, query) => {
  let expected = await compile(query)()
  let func = await compile(query, { backend: "c-new", outDir, outFile: name })
  expect(await func()).toEqual(expected)
}

// ----- constants and arithmetic -----

test("testConst", async () => { await same("testConst", rh`1`) })
test("testArith", async () => { await same("testArith", rh`1 + 2 * 3`) })

// ----- comparisons: true or undefined, never false -----

test("testEqualTrue", async () => { await same("testEqualTrue", rh`1 == 1`) })
test("testEqualUndefined", async () => { await same("testEqualUndefined", rh`1 == 2`) })
test("testNotEqual", async () => { await same("testNotEqual", rh`1 != 2`) })
test("testLessThanTrue", async () => { await same("testLessThanTrue", rh`1 < 2`) })
test("testLessThanUndefined", async () => { await same("testLessThanUndefined", rh`1 < 0`) })
test("testLessThanOrEqual", async () => { await same("testLessThanOrEqual", rh`1 <= 2`) })
test("testGreaterThan", async () => { await same("testGreaterThan", rh`2 > 1`) })
test("testGreaterThanOrEqual", async () => { await same("testGreaterThanOrEqual", rh`2 >= 1`) })

// ----- boolean connectives -----

test("testAnd", async () => { await same("testAnd", rh`1 == 1 & 2 == 2`) })
test("testAndUndefined", async () => { await same("testAndUndefined", rh`1 == 1 & 2 == 3`) })
test("testAndAlso", async () => { await same("testAndAlso", rh`1 == 1 && 2 == 2`) })
test("testOrElse", async () => { await same("testOrElse", rh`1 == 2 || 2 == 2`) })
test("testOrElseUndefined", async () => { await same("testOrElseUndefined", rh`1 == 2 || 2 == 3`) })

// ----- aggregation -----

test("testSum", async () => { await same("testSum", rh`sum ${data}.*.value`) })
test("testCount", async () => { await same("testCount", rh`count ${data}.*.value`) })
test("testMin", async () => { await same("testMin", rh`min ${data}.*.value`) })
test("testMax", async () => { await same("testMax", rh`max ${data}.*.value`) })
test("testProduct", async () => { await same("testProduct", rh`product ${data}.*.value`) })
test("testFirst", async () => { await same("testFirst", rh`first ${data}.*.value`) })
test("testLast", async () => { await same("testLast", rh`last ${data}.*.value`) })

// ----- grouping -----

test("testGroup", async () => { await same("testGroup", rh`${data}.*A.value | group *A`) })
test("testGroupByKey", async () => {
  await same("testGroupByKey", rh`{${data}.*.key: sum(${data}.*.value)}`)
})
test("testNestedGroup", async () => {
  await same("testNestedGroup", rh`${nested}.*A.*B.value | group *B | group *A`)
})
test("testSumNested", async () => { await same("testSumNested", rh`sum ${nested}.*A.*B.value`) })

// ----- joins -----

test("testJoin", async () => {
  await same("testJoin", rh`${data}.*A.value + ${other}.*A.value | group *A`)
})
test("testJoinAggr", async () => {
  await same("testJoinAggr", rh`(sum ${data}.*A.value) + (sum ${other}.*A.value)`)
})
test("testJoinMixed", async () => {
  await same("testJoinMixed", rh`((sum ${data}.*A.value) + ${other}.*A.value) | group *A`)
})
test("testCrossGroup", async () => {
  await same("testCrossGroup", rh`${data}.*A.value + ${other}.*B.value | group *B | group *A`)
})

// ----- general json -----

test("testMixedGroup", async () => { await same("testMixedGroup", rh`${mixed}.*A.v | group *A`) })
test("testMissingKey", async () => { await same("testMissingKey", rh`count ${mixed}.*.v`) })
test("testArrayInput", async () => { await same("testArrayInput", rh`sum ${arrays}.items.*.v`) })
test("testArrayGroup", async () => {
  await same("testArrayGroup", rh`${arrays}.items.*A.v | group *A`)
})

// ----- codegen properties -----

test("testLoadDedup", async () => {
  let query = rh`(sum ${data}.*.value) + (count ${data}.*.value)`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadDedup" })
  expect(func.explain.code.match(/rh_load_json/g)).toHaveLength(1)
  expect(await func()).toEqual(73)
})

// See the runtime header for the one deliberate divergence from the js
// backend: rt.stateful.sum folds with bare `s + x`, so a string value makes it
// concatenate rather than add. c-new coerces instead.
