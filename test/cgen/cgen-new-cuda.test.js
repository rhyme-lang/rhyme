// The c-new backend's device path: `dot` over device vectors.
//
// Two levels, because CUDA is not available everywhere:
//
//   - the generated C is asserted directly, with the compiler stubbed out, so
//     the lowering is covered on any machine;
//   - the end-to-end run is gated on nvcc, like the cuda tests in
//     cgen-tensors.test.js.
//
// There is no differential test against the js backend here: rt.pure.dot does
// not exist, so `dot` has no reference implementation to compare against. The
// expected value is the one the "cuda" backend's dotProduct test uses.

const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const build = require('../../src/cgen/build')

const fs = require('fs/promises')
const { execFileSync } = require('child_process')

let hasCuda = false
try {
  execFileSync('nvcc', ['--version'], { stdio: 'ignore' })
  hasCuda = true
} catch (e) {}
let testCuda = hasCuda ? test : test.skip

let outDir = "out/cnew-cuda"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

let vecSchema = typing.createVec("dense", types.u32, 1, types.u32)
let vecA = rh`loadJSON "./data/json/tensors/vecA.json" ${vecSchema}`
let vecB = rh`loadJSON "./data/json/tensors/vecB.json" ${vecSchema}`

// Compile as far as the C text and no further: build.compile shells out to a
// compiler this machine may not have. Restored after each use, so a stub cannot
// leak into another test and silently pass a program that never built.
let codeOf = async (name, query) => {
  let compileReal = build.compile, runReal = build.run
  build.compile = async () => 0
  build.run = async () => { throw new Error("stubbed: not executable") }
  try {
    let func = await compile(query, { backend: "c-new", outDir, outFile: name })
    return func.explain.code
  } finally {
    build.compile = compileReal
    build.run = runReal
  }
}

test("dotCodegen", async () => {
  let code = await codeOf("dotCodegen", rh`dot ${vecA} ${vecB}`)

  // the CUDA header comes in only through rhyme_cuda.h, and only here
  expect(code).toContain('#include "rhyme_cuda.h"')
  expect(code).not.toContain('#include "rhyme_rt.h"')

  // handle created before the work and destroyed after the output
  expect(code.indexOf("rh_cuda_begin();")).toBeLessThan(code.indexOf("cublasSdot"))
  expect(code.indexOf("rh_cuda_end();")).toBeGreaterThan(code.indexOf("rh_cuda_print"))
  expect(code.indexOf("rh_cuda_end();")).toBeLessThan(code.indexOf("return 0;"))

  // one transfer per operand, each reporting its own length
  expect(code.match(/rh_cuda_from_json/g)).toHaveLength(2)

  // the call itself stays in the generated program, with unit strides and the
  // result in a device vector rather than a host float
  expect(code).toMatch(
    /float \*(\w+) = rh_cuda_alloc\(1\);[\s\S]*cublasSdot\(rh_cublas_handle, \(int\)\w+, \w+, 1, \w+, 1, \1\)/)

  // a reduction's one-element vector prints as a scalar, matching its f32 type
  expect(code).toContain("rh_cuda_print_scalar(")
  expect(code).not.toContain("rh_print_val(")
})

test("dotLengthCheck", async () => {
  // cublasSdot reads n elements from both sides, so the lengths are checked
  // before the call rather than trusted from the first operand
  let code = await codeOf("dotLengthCheck", rh`dot ${vecA} ${vecB}`)
  let check = code.split("\n").find(l => l.includes("dot on vectors of length"))
  expect(check).toBeDefined()
  expect(code.indexOf(check)).toBeLessThan(code.indexOf("cublasSdot"))
})

test("hostQueryStaysOffTheDevice", async () => {
  // the device path must not leak into a query that does not use it
  let data = rh`loadJSON "./data/json/semantics/data.json" ${types.unknown}`
  let code = await codeOf("hostQuery", rh`sum ${data}.*.value`)
  expect(code).toContain('#include "rhyme_rt.h"')
  expect(code).not.toContain("cublas")
})

// ----- the device/host boundary -----
//
// A device scalar meeting host code is copied back, once, at the point the host
// needs it -- and not before, so a result that is only printed never crosses
// the bus in generated code at all.

test("copyBackForHostArithmetic", async () => {
  let code = await codeOf("dotPlus", rh`(dot ${vecA} ${vecB}) + 1`)

  let copy = code.indexOf("rh_cuda_to_host_scalar(")
  expect(copy).toBeGreaterThan(code.indexOf("cublasSdot"))   // after the work
  expect(copy).toBeLessThan(code.indexOf("rh_pure_plus"))    // before the use
  // the copy names the device scalar and binds a plain C float
  expect(code).toMatch(/float (\w+) = rh_cuda_to_host_scalar\(\w+\);/)
})

test("copyBackFeedsNativeArithmetic", async () => {
  // once back on the host it is an ordinary C float, so the multiply lowers as
  // native C rather than through the boxed runtime
  let code = await codeOf("dotSquare", rh`(dot ${vecA} ${vecB}) * (dot ${vecA} ${vecB})`)
  expect(code.match(/rh_cuda_to_host_scalar/g)).toHaveLength(2)
  expect(code).toMatch(/printf\("%\.3f", \(float\)\(h_\w+ \* h_\w+\)\);/)
  expect(code).not.toContain("rh_pure_times")
})

test("copyBackFeedsAnAccumulator", async () => {
  let code = await codeOf("dotSum", rh`sum (dot ${vecA} ${vecB})`)
  expect(code).toContain("rh_cuda_to_host_scalar(")
  expect(code).not.toContain("rh_print_val(")
})

test("printingDoesNotCopyBackInGeneratedCode", async () => {
  // rh_cuda_print_scalar does its own read-back, so a printed result needs no
  // copy in the generated program
  let code = await codeOf("dotPrint", rh`dot ${vecA} ${vecB}`)
  expect(code).toContain("rh_cuda_print_scalar(")
  expect(code).not.toContain("rh_cuda_to_host_scalar(")
})

testCuda("dotProduct", async () => {
  let func = await compile(rh`dot ${vecA} ${vecB}`,
                           { backend: "c-new", outDir, outFile: "dotProduct" })
  expect(await func()).toEqual(10)
})

testCuda("dotProductPlusOne", async () => {
  let func = await compile(rh`(dot ${vecA} ${vecB}) + 1`,
                           { backend: "c-new", outDir, outFile: "dotProductPlusOne" })
  expect(await func()).toEqual(11)
})
