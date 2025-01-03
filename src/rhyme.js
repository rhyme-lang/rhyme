let api = {}
exports.api = api
exports.pipe = pipe

const codegen = require('./c1-codegen')
const new_codegen = require('./new-codegen')
const ir = require('./c1-ir')
const graphics = require('./graphics')

const simpleEval = require('./simple-eval')
const { typing } = require('./typing')
// const primitiveEval = require('../src/primitive-eval')


function ast_wrap(e) {
  console.assert(e.xxkey)
  return { rhyme_ast: e }
}

function ast_unwrap(e) {
  if (typeof e === "object" && "rhyme_ast" in e) return e.rhyme_ast
  return { xxkey: "hole", xxop: e }
}


//
// reducer (e.g., sum) expressions
//
api["sum"] = (e) => ast_wrap({
  xxkey: "sum",
  xxparam: [ast_unwrap(e)]
})
api["product"] = (e) => ast_wrap({
  xxkey: "sum",
  xxparam: [ast_unwrap(e)]
})
api["count"] = (e) => ast_wrap({
  xxkey: "count",
  xxparam: [ast_unwrap(e)]
})
api["max"] = (e) => ast_wrap({
  xxkey: "max",
  xxparam: [ast_unwrap(e)]
})
api["min"] = (e) => ast_wrap({
  xxkey: "min",
  xxparam: [ast_unwrap(e)]
})
api["join"] = (e) => ast_wrap({
  xxkey: "join",
  xxparam: [ast_unwrap(e)]
})
api["array"] = (...es) => ast_wrap({
  xxkey: "array",
  xxparam: es.map(ast_unwrap)
})
api["object"] = (...es) => ast_wrap({
  xxkey: "object",
  xxparam: es.map(ast_unwrap)
})
api["first"] = (e) => ast_wrap({
  xxkey: "first",
  xxparam: [ast_unwrap(e)]
})
api["last"] = (e) => ast_wrap({
  xxkey: "last",
  xxparam: [ast_unwrap(e)]
})
api["single"] = (e) => ast_wrap({
  xxkey: "last", // TODO: check that values are equal, like c2
  xxparam: [ast_unwrap(e)]
})
api["keyval"] = (k, v) => ast_wrap({
  xxkey: "keyval",
  xxparam: [ast_unwrap(k), ast_unwrap(v)]
})
api["flatten"] = (k, v) => ast_wrap({
  xxkey: "flatten",
  xxparam: [ast_unwrap(k), ast_unwrap(v)]
})
api["merge"] = (k, v) => ast_wrap({
  xxkey: "merge",
  xxparam: [ast_unwrap(k), ast_unwrap(v)]
})
api["group"] = (e, k) => ast_wrap({
  xxkey: "object",
  xxparam: [ast_unwrap(k),ast_unwrap(e)]
})
// api["group"] = (e, k) => ({
//   "_IGNORE_": api.keyval(k,e) // alternative
// })
//
// path expressions
//
api["input"] = () => ast_wrap({
  xxkey: "raw",
  xxop: "inp"
})
api["get"] = (e1, e2) => ast_wrap({ // NOTE: single-arg case!
  xxkey: "get",
  xxparam: e2 ? [ast_unwrap(e1), ast_unwrap(e2)] : [ast_unwrap(e1)]
})
api["apply"] = (e1, e2) => ast_wrap({
  xxkey: "apply",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["pipe"] = (e1, e2) => ast_wrap({ // reverse apply
  xxkey: "apply",
  xxparam: [ast_unwrap(e2), ast_unwrap(e1)]
})
api["plus"] = (e1, e2) => ast_wrap({
  xxkey: "plus",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["minus"] = (e1, e2) => ast_wrap({
  xxkey: "minus",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["times"] = (e1, e2) => ast_wrap({
  xxkey: "times",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["fdiv"] = (e1, e2) => ast_wrap({
  xxkey: "fdiv",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["div"] = (e1, e2) => ast_wrap({
  xxkey: "div",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["mod"] = (e1, e2) => ast_wrap({
  xxkey: "mod",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
api["and"] = (e1, e2) => ast_wrap({
  xxkey: "and",
  xxparam: [ast_unwrap(e1), ast_unwrap(e2)]
})
// ---------- Fluent API ----------
let Pipe = {
  sum: function () { return pipe(api.sum(this)) },
  count: function () { return pipe(api.count(this)) },
  max: function () { return pipe(api.max(this)) },
  first: function () { return pipe(api.first(this)) },
  last: function () { return pipe(api.last(this)) },
  group: function (k) { return pipe(api.group(this, k)) },
  map: function (e) { return pipe(api.apply(e, this)) },
  get: function (e) { return pipe(api.get(this, e)) },
}
function pipe(e) {
  if (typeof (e) === "string")
    e = api.get(e)
  let res = Object.create(Pipe)
  for (let k in e)
    res[k] = e[k]
  return res
}

//
// main entrypoint
//
api["show"] = (query, data, explain) => {
  let f = api["query"](query)
  return display(f(data))
}
api["exec"] = (query, data) => {
  let f = api["query"](query)
  return f(data)
}
// api["getIR"] = (query) => {
//   resetState()
//   transStatefulTopLevel(query)
//   return {
//     assignments: assignmentStms,
//     generators: generatorStms
//   }
// }


let configLogDebugOutput = false

function logDebugOutput(info) {
  if (!configLogDebugOutput) return
  try { expect } catch (e) { return } // skip if not using test runner
  let st = expect.getState()
  let prefix = st.snapshotState._rootDir + "/test/"
  let suffix = ".test.js"
  let base = st.testPath
  let name = st.currentTestName
  let file = "out/"+base.slice(prefix.length, -suffix.length)+"."+name//+".js"
  let dir = file.split("/").slice(0,-1).join("/")
  const fs = require('fs')
  const os = require('child_process')
  os.exec("mkdir -p '"+dir+"'", function(err, stdout) {
    for (let k in info) {
      fs.writeFileSync(file+"."+k+".js", "// "+name+"\n" + info[k])
    }
  })
}


api["query"] = api["compile"] = (query, schema=typing.any) => {
    query = ast_unwrap(query)
    let rep = ir.createIR(query)
    let c1 = codegen.generate(rep)
    let c1_opt = new_codegen.generate(rep)
    let c2 = simpleEval.compile(query, {schema: schema})
    let c2_new = simpleEval.compile(query, {schema: schema, newCodegen: true })
    let wrapper = (x) => {
        let res1 = c1(x)
        let res1_opt = c1_opt(x)
        let res2 = c2(x)
        let res2_new = c2_new(x)

        let cmp = src => ({
          toEqual: dst => {
            let ssrc = JSON.stringify(src)
            let sdst = JSON.stringify(dst)
            console.assert(ssrc == sdst, "result mismatch")
          }})
        try { cmp = expect } catch (e) {} // use test runner if available

        cmp(res1_opt).toEqual(res1)
        cmp(res2).toEqual(res1)
        cmp(res2_new).toEqual(res2)
        return res2
    }
    logDebugOutput({
      c1: c1.explain.codeString,
      c1_opt: c1_opt.explain.codeString,
      c2: c2.explain.code,
      c2_new: c2_new.explain.codeString,
    })
    wrapper.c1 = c1
    wrapper.c1_opt = c1_opt
    wrapper.c2 = c2
    wrapper.c2_new = c2_new
    wrapper.explain = c1.explain
    wrapper.explain_opt = c1_opt.explain
    wrapper.explain2 = c2.explain
    wrapper.explain2_new = c2_new.explain
    return wrapper
}
api["compileC1"] = api["compileFastPathOnly"] = (query) => {
    query = ast_unwrap(query)
    let rep = ir.createIR(query)
    let c1 = codegen.generate(rep)
    let c1_opt = new_codegen.generate(rep)
    let wrapper = (x) => {
        let res1 = c1(x)
        let res1_opt = c1_opt(x)

        let cmp = src => ({
          toEqual: dst => {
            let ssrc = JSON.stringify(src)
            let sdst = JSON.stringify(dst)
            console.assert(ssrc == sdst, "result mismatch")
          }})
        try { cmp = expect } catch (e) {} // use test runner if available

        cmp(res1_opt).toEqual(res1)
        return res1
    }
    logDebugOutput({
      c1: c1.explain.codeString,
      c1_opt: c1_opt.explain.codeString,
    })
    wrapper.c1 = c1
    wrapper.c1_opt = c1_opt
    wrapper.explain = c1.explain
    wrapper.explain_opt = c1_opt.explain
    return wrapper
}

api["compileNew"] = (query) => {
  query = ast_unwrap(query)
  let rep = ir.createIR(query)
  let c1 = new_codegen.generate(rep)
  let c2 = simpleEval.compile(query)
  let c2_new = simpleEval.compile(query, { newCodegen: true })
  let wrapper = (x) => {
      let res1 = c1(x)
      let res2 = c2(x)
      let res2_new = c2_new(x)

      let cmp = src => ({
        toEqual: dst => {
          let ssrc = JSON.stringify(src)
          let sdst = JSON.stringify(dst)
          console.assert(ssrc == sdst, "result mismatch")
        }})
      try { cmp = expect } catch (e) {} // use test runner if available

      cmp(res2).toEqual(res1)
      cmp(res2_new).toEqual(res2)
      return res2
  }
  logDebugOutput({
    c1: c1.explain.codeString,
    c2: c2.explain.codeString,
    c2_new: c2_new.explain.codeString,
  })
  wrapper.c1 = c1
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain = c1.explain
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

api["compileC2"] = (query) => {
  query = ast_unwrap(query)
  // let rep = ir.createIR(query)
  let c2 = simpleEval.compile(query)
  let c2_new = simpleEval.compile(query, { newCodegen: true })
  let wrapper = (x) => {
      let res2 = c2(x)
      let res2_new = c2_new(x)

      let cmp = src => ({
        toEqual: dst => {
          let ssrc = JSON.stringify(src)
          let sdst = JSON.stringify(dst)
          console.assert(ssrc == sdst, "result mismatch")
        }})
      try { cmp = expect } catch (e) {} // use test runner if available

      cmp(res2_new).toEqual(res2)
      return res2
  }
  logDebugOutput({
    c2: c2.explain.codeString,
    c2_new: c2_new.explain.codeString,
  })
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain = c2.explain
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

// displaying graphics/visualizations in the browser
api["display"] = (o, domParent) => graphics.display(o, domParent)
