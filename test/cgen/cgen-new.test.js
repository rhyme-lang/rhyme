// The c-new backend.
//
// Most of these are lifted from test/semantics/se-basic.test.js, keeping the
// original test names so the correspondence is visible. That suite's `data`,
// `other`, `nested` and `nestedB` are byte-identical to the json files loaded
// below, so the queries and their expected results carry over unchanged -- the
// point being to show which of the language's semantics the C backend covers.
//
// Everything here uses types.unknown. c-new is the general-JSON path, and this
// suite exercises it: mixed.json in particular (mixed value types, a missing
// key, a json null) is a shape the schema-bound "c" backend cannot express at
// all. A typed mirror of this suite, driving the specialized path, is still to
// be written.
//
// One query per test, and outFile is the test name, matching the other cgen
// suites. Each test compiles and runs a C program, so a test holding several
// queries adds up fast -- on macOS the first execution of a freshly built
// binary costs more than the compile does.

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
let nestedB = rh`loadJSON "./data/json/semantics/nestedB.json" ${types.unknown}`
let mixed = rh`loadJSON "./data/json/semantics/mixed.json" ${types.unknown}`
let arrays = rh`loadJSON "./data/json/semantics/arrays.json" ${types.unknown}`

//
// ----- scalars, from se-basic -----
//

test("test_NCG_Trivial0", async () => {
  let query = rh`1 + 4`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "test_NCG_Trivial0" })
  expect(await func()).toEqual(5)
})

test("test_NCG_Trivial1", async () => {
  let query = rh`${data}.A.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "test_NCG_Trivial1" })
  expect(await func()).toEqual(40)
})

test("testScalar0", async () => {
  let query = rh`${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testScalar0" })
  expect(await func()).toEqual({ A: 40, B: 20, C: 10 })
})

test("testScalar1", async () => {
  let query = rh`sum ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testScalar1" })
  expect(await func()).toEqual(70)
})

test("testKeyAsValue", async () => {
  let query = rh`${data}.*A.key`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testKeyAsValue" })
  expect(await func()).toEqual({ A: "U", B: "U", C: "V" })
})

test("testNestedStatic", async () => {
  let query = rh`${nested}.U.A.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNestedStatic" })
  expect(await func()).toEqual(10)
})

//
// ----- correlated and uncorrelated joins, from se-basic -----
//

test("testZipScalar2", async () => {
  let query = rh`${data}.*A.value + ${other}.*A.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar2" })
  expect(await func()).toEqual({ A: 140, B: 420 })
})

test("testZipScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*A.value)`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar3" })
  expect(await func()).toEqual(560)
})

test("testZipScalar4", async () => {
  let query = rh`(sum ${data}.*A.value) + ${other}.*A.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar4" })
  expect(await func()).toEqual({ A: 140, B: 420 })
})

test("testJoinScalar2", async () => {
  let query = rh`${data}.*A.value + ${other}.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar2" })
  expect(await func()).toEqual({
    A: { A: 140, B: 440, D: 240 },
    B: { A: 120, B: 420, D: 220 },
    C: { A: 110, B: 410, D: 210 },
  })
})

test("testJoinScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*B.value)`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar3" })
  expect(await func()).toEqual(770)
})

test("testJoinScalar4", async () => {
  let query = rh`(sum ${data}.*A.value) + ${other}.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar4" })
  expect(await func()).toEqual({ A: 170, B: 470, D: 270 })
})

//
// ----- nesting, from se-basic -----
//

test("testNested0", async () => {
  let query = rh`${nested}.*A.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNested0" })
  expect(await func()).toEqual({
    U: { A: 10, B: 20 }, V: { B: 30, C: 40 }, W: { D: 50, E: 60 },
  })
})

test("testNested1", async () => {
  let query = rh`sum ${nested}.*A.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNested1" })
  expect(await func()).toEqual(210)
})

test("testZipNested2", async () => {
  // the inner variable is restricted to the keys `other` has
  let query = rh`${nested}.*A.*B.value + ${other}.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipNested2" })
  expect(await func()).toEqual({ U: { A: 110, B: 420 }, V: { B: 430 }, W: { D: 250 } })
})

test("testZipNested3", async () => {
  // three levels in the result
  let query = rh`${nested}.*A.*B.value + ${nestedB}.*C.*B.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipNested3" })
  expect(await func()).toEqual({ V: { C: { X: 540, Y: 640 } } })
})

//
// ----- grouping -----
//

test("testGroup", async () => {
  let query = rh`${data}.*A.value | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup" })
  expect(await func()).toEqual({ A: 40, B: 20, C: 10 })
})

test("testGroup1", async () => {
  let query = rh`{${data}.*.key: sum(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup1" })
  expect(await func()).toEqual({ U: 60, V: 10 })
})

test("testGroup2", async () => {
  // the inner variable is not the one being grouped on, so each group sums all
  let query = rh`{${data}.*.key: sum(${data}.*B.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup2" })
  expect(await func()).toEqual({ U: 70, V: 70 })
})

test("testGroupCount", async () => {
  let query = rh`{${data}.*.key: count(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroupCount" })
  expect(await func()).toEqual({ U: 2, V: 1 })
})

test("testGroupMin", async () => {
  let query = rh`{${data}.*.key: min(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroupMin" })
  expect(await func()).toEqual({ U: 20, V: 10 })
})

test("testGroupMax", async () => {
  let query = rh`{${data}.*.key: max(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroupMax" })
  expect(await func()).toEqual({ U: 40, V: 10 })
})

test("testGroupFirst", async () => {
  let query = rh`{${data}.*.key: first(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroupFirst" })
  expect(await func()).toEqual({ U: 40, V: 10 })
})

test("testNestedGroup", async () => {
  let query = rh`${nested}.*A.*B.value | group *B | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNestedGroup" })
  expect(await func()).toEqual({
    U: { A: 10, B: 20 }, V: { B: 30, C: 40 }, W: { D: 50, E: 60 },
  })
})

test("testJoinGroup", async () => {
  let query = rh`${data}.*A.value + ${other}.*A.value | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinGroup" })
  expect(await func()).toEqual({ A: 140, B: 420 })
})

test("testCrossGroup", async () => {
  let query = rh`${data}.*A.value + ${other}.*B.value | group *B | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testCrossGroup" })
  expect(await func()).toEqual({
    A: { A: 140, B: 440, D: 240 },
    B: { A: 120, B: 420, D: 220 },
    C: { A: 110, B: 410, D: 210 },
  })
})

//
// ----- ungrouped aggregation -----
//

test("testCount", async () => {
  let query = rh`count ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testCount" })
  expect(await func()).toEqual(3)
})

test("testMin", async () => {
  let query = rh`min ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMin" })
  expect(await func()).toEqual(10)
})

test("testMax", async () => {
  let query = rh`max ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMax" })
  expect(await func()).toEqual(40)
})

test("testProduct", async () => {
  let query = rh`product ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testProduct" })
  expect(await func()).toEqual(8000)
})

test("testFirst", async () => {
  let query = rh`first ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testFirst" })
  expect(await func()).toEqual(40)
})

test("testLast", async () => {
  let query = rh`last ${data}.*.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLast" })
  expect(await func()).toEqual(10)
})

test("testMaybeSum", async () => {
  let query = rh`sum? ${other}.*A.value`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMaybeSum" })
  expect(await func()).toEqual(700)
})

//
// ----- arithmetic -----
//

test("testArithChain", async () => {
  let query = rh`(sum ${data}.*.value) * 2 - 10`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testArithChain" })
  expect(await func()).toEqual(130)
})

test("testDiv", async () => {
  let query = rh`(sum ${data}.*.value) / 4`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testDiv" })
  expect(await func()).toEqual(17.5)
})

test("testMod", async () => {
  let query = rh`(sum ${data}.*.value) % 3`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMod" })
  expect(await func()).toEqual(1)
})

//
// ----- comparisons: true or undefined, never false. from se-basic -----
//

test("testEqualTrue", async () => {
  let func = await compile(rh`1 == 1`, { backend: "c-new", outDir, outFile: "testEqualTrue" })
  expect(await func()).toEqual(true)
})

test("testEqualUndefined", async () => {
  let func = await compile(rh`1 == 2`, { backend: "c-new", outDir, outFile: "testEqualUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testNotEqualTrue", async () => {
  let func = await compile(rh`1 != 2`, { backend: "c-new", outDir, outFile: "testNotEqualTrue" })
  expect(await func()).toEqual(true)
})

test("testNotEqualUndefined", async () => {
  let func = await compile(rh`1 != 1`, { backend: "c-new", outDir, outFile: "testNotEqualUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testLessThanTrue", async () => {
  let func = await compile(rh`1 < 2`, { backend: "c-new", outDir, outFile: "testLessThanTrue" })
  expect(await func()).toEqual(true)
})

test("testLessThanUndefined", async () => {
  let func = await compile(rh`1 < 0`, { backend: "c-new", outDir, outFile: "testLessThanUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testLessThanOrEqualTrue", async () => {
  let func = await compile(rh`1 <= 2`, { backend: "c-new", outDir, outFile: "testLessThanOrEqualTrue" })
  expect(await func()).toEqual(true)
})

test("testLessThanOrEqualUndefined", async () => {
  let func = await compile(rh`1 <= 0`, { backend: "c-new", outDir, outFile: "testLessThanOrEqualUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testGreaterThanTrue", async () => {
  let func = await compile(rh`2 > 1`, { backend: "c-new", outDir, outFile: "testGreaterThanTrue" })
  expect(await func()).toEqual(true)
})

test("testGreaterThanUndefined", async () => {
  let func = await compile(rh`0 > 1`, { backend: "c-new", outDir, outFile: "testGreaterThanUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testGreaterThanOrEqualTrue", async () => {
  let func = await compile(rh`2 >= 1`, { backend: "c-new", outDir, outFile: "testGreaterThanOrEqualTrue" })
  expect(await func()).toEqual(true)
})

test("testGreaterThanOrEqualUndefined", async () => {
  let func = await compile(rh`0 >= 1`, { backend: "c-new", outDir, outFile: "testGreaterThanOrEqualUndefined" })
  expect(await func()).toEqual(undefined)
})

//
// ----- connectives, from se-basic -----
//

test("testAndTrue", async () => {
  let func = await compile(rh`1 == 1 & 2 == 2`, { backend: "c-new", outDir, outFile: "testAndTrue" })
  expect(await func()).toEqual(true)
})

test("testAndUndefined", async () => {
  let func = await compile(rh`1 == 1 & 2 == 3`, { backend: "c-new", outDir, outFile: "testAndUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testAndAlsoTrue", async () => {
  let func = await compile(rh`1 == 1 && 2 == 2`, { backend: "c-new", outDir, outFile: "testAndAlsoTrue" })
  expect(await func()).toEqual(true)
})

test("testAndAlsoUndefined", async () => {
  let func = await compile(rh`1 == 1 && 2 == 3`, { backend: "c-new", outDir, outFile: "testAndAlsoUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testOrElseTrue", async () => {
  let func = await compile(rh`1 == 2 || 2 == 2`, { backend: "c-new", outDir, outFile: "testOrElseTrue" })
  expect(await func()).toEqual(true)
})

test("testOrElseUndefined", async () => {
  let func = await compile(rh`1 == 2 || 2 == 3`, { backend: "c-new", outDir, outFile: "testOrElseUndefined" })
  expect(await func()).toEqual(undefined)
})

test("testIfElseThenBranch", async () => {
  let func = await compile(rh`ifElse (1 == 1) 3 5`, { backend: "c-new", outDir, outFile: "testIfElseThenBranch" })
  expect(await func()).toEqual(3)
})

test("testIfElseElseBranch", async () => {
  let func = await compile(rh`ifElse (1 != 1) 3 5`, { backend: "c-new", outDir, outFile: "testIfElseElseBranch" })
  expect(await func()).toEqual(5)
})

test("testOrElseData", async () => {
  let query = rh`${other}.*A.value || 0`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testOrElseData" })
  expect(await func()).toEqual({ A: 100, B: 400, D: 200 })
})

test("testOrElseMissing", async () => {
  let query = rh`${other}.Z.value || "none"`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testOrElseMissing" })
  expect(await func()).toEqual("none")
})

//
// ----- general json: shapes the schema-bound backend cannot express -----
//

test("testMixedGroup", async () => {
  // mixed value types in one collection; the record with no `v` drops out,
  // and a json null survives as null
  let query = rh`${mixed}.*A.v | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMixedGroup" })
  expect(await func()).toEqual({ a: 1, b: "2", c: 3.5, e: null })
})

test("testMissingKey", async () => {
  let query = rh`count ${mixed}.*.v`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMissingKey" })
  expect(await func()).toEqual(4)
})

test("testMixedFirst", async () => {
  let query = rh`first ${mixed}.*.v`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMixedFirst" })
  expect(await func()).toEqual(1)
})

test("testArrayInput", async () => {
  let query = rh`sum ${arrays}.items.*.v`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testArrayInput" })
  expect(await func()).toEqual(6)
})

test("testArrayGroup", async () => {
  // iterating an array binds the index as the key
  let query = rh`${arrays}.items.*A.v | group *A`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testArrayGroup" })
  expect(await func()).toEqual({ 0: 1, 1: 2, 2: 3 })
})

//
// ----- codegen properties -----
//

test("testLoadDedup", async () => {
  let query = rh`(sum ${data}.*.value) + (count ${data}.*.value)`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLoadDedup" })
  expect(func.explain.code.match(/rh_load_json/g)).toHaveLength(1)
  expect(await func()).toEqual(73)
})

//
// ----- not yet supported -----
//
// These are the gaps, kept as skipped tests rather than left unwritten so that
// the coverage boundary is visible. Expected values are what the js backend
// produces today.

// needs the `array` stateful op -- rh_stateful_array does not exist
test.skip("testGroup0", async () => {
  let query = rh`{${data}.*.key: array(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup0" })
  expect(await func()).toEqual({ U: [40, 20], V: [10] })
})

// needs `prefix` -- lower.js throws "unsupported assignment prefix"
test.skip("testPrefixSum1", async () => {
  let query = rh`{${data}.*.key: prefix_sum(${data}.*.value)}`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testPrefixSum1" })
  expect(await func()).toEqual({ U: [40, 60], V: [10] })
})

// needs `mkTuple` -- lower.js throws "unsupported expression mkTuple"
test.skip("testMkTuple", async () => {
  let query = rh`{ a: 1, b: 2, c: 3 }`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMkTuple" })
  expect(await func()).toEqual({ a: 1, b: 2, c: 3 })
})
