/**
 @module API
*/

const codegen = require('./codegen')
const ir = require('./ir')

// this file contains the main API for rhyme
// TODO: minimal docs atm. Update with examples, etc.

//
// reducer (e.g., sum) expressions
//

/**
 * Sum operation.
 * @function
 * @param {*} expr - Argument to sum over.
 * @example
 *  api.sum("data.*.value")- finds the 
 */
exports.sum = (expr) => ({
    xxkey: "sum",
    xxparam: expr
})

/**
 * Count operation.
 * @function
 * @param {*} expr - Argument to count over.
 * @example
 *  api.count("data.*.value")
 */
exports.count = (expr) => ({
    xxkey: "count",
    xxparam: expr
})

/**
 * Max operation.
 * @function
 * @param {*} expr - Argument to find the maximum value.
 * @example
 *  api.max("data.*.value")
 */
exports.max = (expr) => ({
    xxkey: "max",
    xxparam: expr
})

/**
 * String join operation.
 * @function
 * @param {*} expr - Strings to join.
 * @example
 * TODO: add example
 */
exports.join = (expr) => ({
    xxkey: "join",
    xxparam: expr
})

/**
 * Array operation.
 * @function
 * @param {...string} exprs - Arguments to create an array.
 * @example
 *  api.array("data.*.value") - will collect all the values into an array
 */
exports.array = (...exprs) => ({
    xxkey: "array",
    xxparam: exprs
})

/**
 * First operation.
 * @function
 * @param {*} expr - Argument to get the first value from.
 * @example
 *  api.first("data.*.value") - will get the first value from the values
 */
exports.first = (expr) => ({
    xxkey: "first",
    xxparam: expr
})

/**
 * Last operation.
 * @function
 * @param {*} expr - Argument to get the last value.
 * @example
 *  api.last("data.*.value") - will get the last value from the values
 */
exports.last = (expr) => ({
    xxkey: "last",
    xxparam: expr
})

/**
 * Key-value operation used as a workaround for JSON with expressions as keys (not allowed in JS).
 * @function
 * @param {*} key - Key argument.
 * @param {*} value - Value argument.
 * @example
 * {"-" : api.keyval(api.get(q, "xyz"), "value")} -- will be equivalent to {api.get(q, "xyz"): "value"}
 */
exports.keyval = (key, value) => ({
    xxkey: "keyval",
    xxparam: [key, value]
})

/**
 * Flatten operation.
 * @function
 * @param {*} k - TODO
 * @param {*} v - TODO
 * @example
 *  TODO
 */
exports.flatten = (k, v) => ({
    xxkey: "flatten",
    xxparam: [k, v]
})

/**
 * Merge operation. TODO: same as keyval?
 * @function
 * @param {*} key - Key argument.
 * @param {*} value - Value argument.
 * @example
 *  TODO: same as keyval?
 */
exports.merge = (key, value) => ({
    xxkey: "merge",
    xxparam: [key, value]
})

//
// path expressions
//

/**
 * TODO: add docs
 * @param {*} exp1 
 * @param {*} exp2 
 * @example
 *  TODO: add example
 */
exports.get = (exp1, exp2) => ({
    xxpath: "get",
    xxparam: [exp1, exp2]
})

/**
 * TODO: add docs 
 * @param {*} e1 
 * @param {*} e2 
 * @example
 *  TODO: add example
 */
exports.apply = (e1, e2) => ({
    xxpath: "apply",
    xxparam: [e1, e2]
})

/**
 * Reverse of apply.
 * @param {*} e1 
 * @param {*} e2 
 * @example
 *  TODO: add example 
 */
exports.pipe = (e1, e2) => ({ // reverse apply
    xxpath: "apply",
    xxparam: [e2, e1]
})

/**
 * Plus operation (e1 + e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.plus = (e1, e2) => ({
    xxpath: "plus",
    xxparam: [e1, e2]
})

/**
 * Minus operation (e1 - e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.minus = (e1, e2) => ({
    xxpath: "minus",
    xxparam: [e1, e2]
})

/**
 * Multiplication operation (e1 * e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.times = (e1, e2) => ({
    xxpath: "times",
    xxparam: [e1, e2]
})

/**
 * Floor division operation (e1 // e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.fdiv = (e1, e2) => ({
    xxpath: "fdiv",
    xxparam: [e1, e2]
})

/**
 * Division operation (e1 / e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.div = (e1, e2) => ({
    xxpath: "div",
    xxparam: [e1, e2]
})

/**
 * Mod operation (e1 % e2)
 * @param {*} e1 
 * @param {*} e2 
 */
exports.mod = (e1, e2) => ({
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
    group: function (k) { let o = {}; o[k] = this; return pipe(o) },
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


exports.show = (query, data, explain) => {
    let f = api["query"](query)
    return display(f(data))
}

/**
 * Compile and execute query on the provided data operation (e1 + e2)
 * @param {*} query - query to execute
 * @param {*} data - a JSON object with the data
 * @example
 *  TODO: add example 
 */
exports.exec = (query, data) => {
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

/**
 * Compile the query and return the generated executable function.
 * @param {*} query - query to execute
 * @example
 *  let data = [{"key": "A", "val": 10}, {"key": "B", "val": 20}, {"key": "A", "val": 30}]
 * let query = { "data.*.key": api.sum()}
 * let func = api.compile(query) // produces the compiled function for the query
 * let res = func({data})        // executes the compiled query on the data
 */
exports.compile = (query) => {
    let rep = ir.createIR(query)
    return codegen.generate(rep)
}