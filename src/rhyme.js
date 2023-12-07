const codegen = require('./codegen')
const ir = require('./ir')

// ---------- API ----------
//
//
let api = {}
exports.api = api
exports.pipe = pipe

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
function sum(expr) {
    return {
        xxkey: "sum",
        xxparam: expr
    }
}
api.sum = sum

/**
 * Count operation.
 * @function
 * @param {*} expr - Argument to count over.
 * @example
 *  api.count("data.*.value")
 */
function count(expr) {
    return {
        xxkey: "count",
        xxparam: expr
    }
}
api.count = count

/**
 * Max operation.
 * @function
 * @param {*} expr - Argument to find the maximum value.
 * @example
 *  api.max("data.*.value")
 */
function max(expr) {
    return {
        xxkey: "max",
        xxparam: expr
    }
}
api.max = max

/**
 * String join operation.
 * @function
 * @param {*} expr - Strings to join.
 * @example
 * TODO: add example
 */
function join(expr) {
    return {
        xxkey: "join",
        xxparam: expr
    }
}
api.join = join

/**
 * Array operation.
 * @function
 * @param {...string} exprs - Arguments to create an array.
 * @example
 *  api.array("data.*.value") - will collect all the values into an array
 */
function array(...exprs) {
    return {
        xxkey: "array",
        xxparam: exprs
    }
}
api.array = array

/**
 * First operation.
 * @function
 * @param {*} expr - Argument to get the first value from.
 * @example
 *  api.first("data.*.value") - will get the first value from the values
 */
function first(expr) {
    return {
        xxkey: "first",
        xxparam: expr
    }
}
api.first = first

/**
 * Last operation.
 * @function
 * @param {*} expr - Argument to get the last value.
 * @example
 *  api.last("data.*.value") - will get the last value from the values
 */
function last(expr) {
    return {
        xxkey: "last",
        xxparam: expr
    }
}
api.last = last

/**
 * Key-value operation used as a workaround for JSON with expressions as keys (not allowed in JS).
 * @function
 * @param {*} key - Key argument.
 * @param {*} value - Value argument.
 * @example
 * {"-" : api.keyval(api.get(q, "xyz"), "value")} -- will be equivalent to {api.get(q, "xyz"): "value"}
 */
function keyval(key, value) {
    return {
        xxkey: "keyval",
        xxparam: [key, value]
    }
}
api.keyval = keyval

/**
 * Flatten operation.
 * @function
 * @param {*} k - TODO
 * @param {*} v - TODO
 * @example
 *  TODO
 */
function flatten(k, v) {
    return {
        xxkey: "flatten",
        xxparam: [k, v]
    }
}
api.flatten = flatten

/**
 * Merge operation. TODO: same as keyval?
 * @function
 * @param {*} key - Key argument.
 * @param {*} value - Value argument.
 * @example
 *  TODO: same as keyval?
 */
function merge(key, value) {
    return {
        xxkey: "merge",
        xxparam: [key, value]
    }
}
api.merge = merge

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
function get(exp1, exp2) {
    return {
        xxpath: "get",
        xxparam: [exp1, exp2]
    }
}
api.get = get

/**
 * TODO: add docs 
 * @param {*} e1 
 * @param {*} e2 
 * @example
 *  TODO: add example
 */
function apply(e1, e2) {
    return {
        xxpath: "apply",
        xxparam: [e1, e2]
    }
}
api.apply = apply

/**
 * Reverse of apply.
 * @param {*} e1 
 * @param {*} e2 
 * @example
 *  TODO: add example 
 */
function pipe_(e1, e2) {
    return {
        xxpath: "apply",
        xxparam: [e2, e1]
    }
}
api.pipe = pipe_

/**
 * Plus operation (e1 + e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function plus(e1, e2) {
    return {
        xxpath: "plus",
        xxparam: [e1, e2]
    }
}
api.plus = plus

/**
 * Minus operation (e1 - e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function minus(e1, e2) {
    return {
        xxpath: "minus",
        xxparam: [e1, e2]
    }
}
api.minus = minus

/**
 * Multiplication operation (e1 * e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function times(e1, e2) {
    return {
        xxpath: "times",
        xxparam: [e1, e2]
    }
}
api.times = times

/**
 * Floor division operation (e1 // e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function fdiv(e1, e2) {
    return {
        xxpath: "fdiv",
        xxparam: [e1, e2]
    }
}
api.fdiv = fdiv

/**
 * Division operation (e1 / e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function div(e1, e2) {
    return {
        xxpath: "div",
        xxparam: [e1, e2]
    }
}
api.div = div

/**
 * Mod operation (e1 % e2)
 * @param {*} e1 
 * @param {*} e2 
 */
function mod(e1, e2) {
    return {
        xxpath: "mod",
        xxparam: [e1, e2]
    }
}
api.mod = mod

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

function show(query, data, explain) {
    let f = api["query"](query)
    return display(f(data))
}
api.show = show

/**
 * Compile and execute query on the provided data operation (e1 + e2)
 * @param {*} query - query to execute
 * @param {*} data - a JSON object with the data
 * @example
 *  TODO: add example 
 */
function exec(query, data) {
    let f = api["query"](query)
    return f(data)
}
api.exec = exec

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
function compile(query) {
    let rep = ir.createIR(query)
    return codegen.generate(rep)
}
api.compile = compile