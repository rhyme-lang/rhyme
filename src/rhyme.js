let api = {}
exports.api = api
exports.pipe = pipe

const codegen = require('./c1-codegen')
const new_codegen = require('./new-codegen')
const ir = require('./c1-ir')
const graphics = require('./graphics')

const simpleEval = require('./simple-eval')
const { typing } = require('./typing')
const { rh } = require('./parser')

const { ops, ast } = require('./shared')

//
// ---------- Parser / quasiquote API ----------
//

exports.rh = rh


//
// ---------- Function-based syntax object API ----------
//

let ast_op = (key, param) => ({
  xxkey: key,
  xxparam: param
})

let ast_op_wrapped = key => (...param) => 
  ast.wrap(ast_op(key, param.map(ast.unwrap)))


// Create a corresponding syntax API entry for all
// registered built-in ops, e.g:
//
//  api.get(a,b)
//  api.sum(a)
//  ...

for (let k in ops.special)
  api[k] = ast_op_wrapped(k)

for (let k in ops.pure)
  api[k] = ast_op_wrapped(k)

for (let k in ops.stateful)
  api[k] = ast_op_wrapped(k)


// some overrides:

api["group"] = (e,k) => api["object"](k,e)

api["input"] = () => ast.wrap(ast.root())


//
// ---------- Fluent syntax API ----------
//

// TODO: make this available on all user-facing
// syntax objects?

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
// ---------- Compilation API ----------
//

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
    query = ast.unwrap(query)
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
    query = ast.unwrap(query)
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
  query = ast.unwrap(query)
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
  query = ast.unwrap(query)
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
