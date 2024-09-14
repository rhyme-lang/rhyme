const codegen = require('./codegen')
const new_codegen = require('./new-codegen')
const ir = require('./ir')
const graphics = require('./graphics')

const simpleEval = require('../src/simple-eval')
// const primitiveEval = require('../src/primitive-eval')

// ---------- API ----------
//
//
let api = {}
exports.api = api
exports.pipe = pipe

//
// reducer (e.g., sum) expressions
//
api["sum"] = (e) => ({
  xxkey: "sum",
  xxparam: e
})
api["count"] = (e) => ({
  xxkey: "count",
  xxparam: e
})
api["max"] = (e) => ({
  xxkey: "max",
  xxparam: e
})
api["min"] = (e) => ({
  xxkey: "min",
  xxparam: e
})
api["join"] = (e) => ({
  xxkey: "join",
  xxparam: e
})
api["array"] = (...es) => ({
  xxkey: "array",
  xxparam: es
})
api["last"] = (e) => ({
  xxkey: "last",
  xxparam: e
})
api["first"] = (e) => ({
  xxkey: "first",
  xxparam: e
})
api["keyval"] = (k, v) => ({
  xxkey: "keyval",
  xxparam: [k, v]
})
api["flatten"] = (k, v) => ({
  xxkey: "flatten",
  xxparam: [k, v]
})
api["merge"] = (k, v) => ({
  xxkey: "merge",
  xxparam: [k, v]
})
api["group"] = (e, k) => ({
  "_IGNORE_": api.keyval(k,e)
})
//
// path expressions
//
api["get"] = (e1, e2) => ({
  xxpath: "get",
  xxparam: [e1, e2]
})
api["apply"] = (e1, e2) => ({
  xxpath: "apply",
  xxparam: [e1, e2]
})
api["pipe"] = (e1, e2) => ({ // reverse apply
  xxpath: "apply",
  xxparam: [e2, e1]
})
api["plus"] = (e1, e2) => ({
  xxpath: "plus",
  xxparam: [e1, e2]
})
api["minus"] = (e1, e2) => ({
  xxpath: "minus",
  xxparam: [e1, e2]
})
api["times"] = (e1, e2) => ({
  xxpath: "times",
  xxparam: [e1, e2]
})
api["fdiv"] = (e1, e2) => ({
  xxpath: "fdiv",
  xxparam: [e1, e2]
})
api["div"] = (e1, e2) => ({
  xxpath: "div",
  xxparam: [e1, e2]
})
api["mod"] = (e1, e2) => ({
  xxpath: "mod",
  xxparam: [e1, e2]
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
api["query"] = api["compile"] = (query) => {
    let rep = ir.createIR(query)
    let c1 = codegen.generate(rep)
    let c1_opt = new_codegen.generate(rep)
    let c2 = simpleEval.compile(query)
    let c2_new = simpleEval.compile(query, { newCodegen: true })
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
api["compileFastPathOnly"] = (query) => {
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
    wrapper.c1 = c1
    wrapper.c1_opt = c1_opt
    wrapper.explain = c1.explain
    wrapper.explain_opt = c1_opt.explain
    return wrapper
}
api["compileNew"] = (query) => {
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
  wrapper.c1 = c1
  wrapper.c2 = c2
  wrapper.c2_new = c2_new
  wrapper.explain = c1.explain
  wrapper.explain2 = c2.explain
  wrapper.explain2_new = c2_new.explain
  return wrapper
}

// displaying graphics/visualizations in the browser
api["display"] = (o, domParent) => graphics.display(o, domParent)
