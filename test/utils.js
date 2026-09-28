// Differential testing: compile a query with several pipelines, run all of
// them on every invocation, and check that they agree. Each wrapper exposes
// the compiled functions (and their explain) as properties.
//
// The pipelines:
//   c1      the original IR-based codegen (c1-codegen.js)
//   c1_opt  the IR-based optimized codegen (new-codegen.js)
//   c2      simple-eval, the canonical pipeline behind api.compile
//   c2_new  simple-eval with newCodegen: true
//
// opts are simple-eval settings, as for api.compile; the C1 pipelines
// ignore them.

const { api } = require('../src/rhyme')
const codegen = require('../src/c1-codegen')
const new_codegen = require('../src/new-codegen')
const ir = require('../src/c1-ir')
const simpleEval = require('../src/simple-eval')
const { ast } = require('../src/shared')

// all four pipelines, returns c2's result (formerly api.compile)
exports.compileCrossCheck = (query, opts = {}) => {
  query = ast.unwrap(query)
  let rep = ir.createIR(query)
  let c1 = codegen.generate(rep)
  let c1_opt = new_codegen.generate(rep)
  let c2 = simpleEval.compile(query, opts)
  let c2_new = simpleEval.compile(query, { ...opts, newCodegen: true })
  let wrapper = (x) => {
    let res1 = c1(x)
    let res1_opt = c1_opt(x)
    let res2 = c2(x)
    let res2_new = c2_new(x)
    expect(res1_opt).toEqual(res1)
    expect(res2).toEqual(res1)
    expect(res2_new).toEqual(res2)
    return res2
  }
  api.logDebugOutput({
    c1: c1.explain.codeString,
    c1_opt: c1_opt.explain.codeString,
    c2: c2.explain.code,
    c2_new: c2_new.explain.code,
  })
  wrapper.c1 = c1
  wrapper.c1_opt = c1_opt
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain1 = c1.explain
  wrapper.explain1_opt = c1_opt.explain
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

// the two C1 pipelines, returns c1's result (formerly api.compileC1)
exports.compileC1CrossCheck = (query) => {
  query = ast.unwrap(query)
  let rep = ir.createIR(query)
  let c1 = codegen.generate(rep)
  let c1_opt = new_codegen.generate(rep)
  let wrapper = (x) => {
    let res1 = c1(x)
    let res1_opt = c1_opt(x)
    expect(res1_opt).toEqual(res1)
    return res1
  }
  api.logDebugOutput({
    c1: c1.explain.codeString,
    c1_opt: c1_opt.explain.codeString,
  })
  wrapper.c1 = c1
  wrapper.c1_opt = c1_opt
  wrapper.explain1 = c1.explain
  wrapper.explain1_opt = c1_opt.explain
  return wrapper
}

// optimized C1 against both C2 pipelines, returns c2's result
// (formerly api.compileNew)
exports.compileC1OptCrossCheck = (query, opts = {}) => {
  query = ast.unwrap(query)
  let rep = ir.createIR(query)
  let c1_opt = new_codegen.generate(rep)
  let c2 = simpleEval.compile(query, opts)
  let c2_new = simpleEval.compile(query, { ...opts, newCodegen: true })
  let wrapper = (x) => {
    let res1_opt = c1_opt(x)
    let res2 = c2(x)
    let res2_new = c2_new(x)
    expect(res2).toEqual(res1_opt)
    expect(res2_new).toEqual(res2)
    return res2
  }
  api.logDebugOutput({
    c1_opt: c1_opt.explain.codeString,
    c2: c2.explain.code,
    c2_new: c2_new.explain.code,
  })
  wrapper.c1_opt = c1_opt
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain1_opt = c1_opt.explain
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

// the two C2 pipelines, returns c2's result (formerly api.compileC2)
exports.compileC2CrossCheck = (query, opts = {}) => {
  query = ast.unwrap(query)
  let c2 = simpleEval.compile(query, opts)
  let c2_new = simpleEval.compile(query, { ...opts, newCodegen: true })
  let wrapper = (x) => {
    let res2 = c2(x)
    let res2_new = c2_new(x)
    expect(res2_new).toEqual(res2)
    return res2
  }
  api.logDebugOutput({
    c2: c2.explain.code,
    c2_new: c2_new.explain.code,
  })
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

// c-new against the js pipeline. Compiling for C is async and writes a program
// to disk, so unlike the helpers above this one returns an async wrapper and
// takes the outDir/outFile it should generate into.
//
// The query has to name its inputs with loadJSON: c-new has no `inp` object,
// by design, so there is nothing to pass at call time and the wrapper takes no
// arguments.
exports.compileCCrossCheck = async (query, opts = {}) => {
  query = ast.unwrap(query)
  let c2 = simpleEval.compile(query, opts)
  let cnew = await simpleEval.compile(query, { ...opts, backend: "c-new" })
  let wrapper = async () => {
    let expected = c2()
    let actual = await cnew()
    expect(actual).toEqual(expected)
    return actual
  }
  wrapper.c2 = c2
  wrapper.cnew = cnew
  wrapper.explain2 = c2.explain
  wrapper.explainC = cnew.explain
  return wrapper
}
