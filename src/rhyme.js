const codegen = require('./codegen')
const ir = require('./ir')
const graphics = require('./graphics')

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
//
// filters
//
api["filter"] = (pred, e) => ({
  xxpath: "filter",
  xxparam: [pred, e]
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
  filter: function (pred) { return pipe(api.filter(pred, this)) },
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
    return codegen.generate(rep)
}

// displaying graphics/visualizations in the browser
api["display"] = (o, domParent) => graphics.display(o, domParent)