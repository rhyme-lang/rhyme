const { quoteVar, debug, trace, print, inspect, error, warn } = require("./utils")
const { parse } = require("./parser")

exports.createIR = (query) => {
    //
    // ---------- Internals ----------
    //
    // string literal or iterator variable?
    let isVar = s => s.startsWith("*") // || s.startsWith("$") || s.startsWith("%")
    //
    // create an expression with code 'txt' and dependency on symbols 'args'
    let expr = (txt, ...args) => ({ txt, deps: args })
    //
    let ident = s => isVar(s) ? expr(quoteVar(s), s) : expr("'" + s + "'")
    //
    // test if expr is a variable (TODO: optimize. Add a flag?)
    let exprIsVar = e => e.deps.length == 1 && e.txt == quoteVar(e.deps[0])
    //
    // TODO: support vararg in select/call?
    let select = (a, b) => expr(a.txt + "[" + b.txt + "]", ...a.deps, ...b.deps)
    let call = (a, b) => expr("" + a.txt + "(" + b.txt + ")", ...a.deps, ...b.deps)
    let binop = (op, a, b) => expr("(" + a.txt + op + b.txt + ")", ...a.deps, ...b.deps)
    let unop = (op, a) => expr(op + "(" + a.txt + ")", ...a.deps)
    //
    // path: number, identifier, selection
    //    disambiguate
    //      - total +=
    //      - data.foo +=
    //
    let generatorStms = []
    let assignmentStms = []
    let allsyms = {}
    //
    let currentGroupPath = []
    let tmpVarCount = 0
    let extraLoopDeps = {} // for each loop sym, a list of extra dependencies
    let tmpVarWriteRank = {} // for each writable var sym, the number of consecutive write stms

    let subQueryCache = {}

    // XXX seems no longer needed
    function resetState() {
        generatorStms = []
        assignmentStms = []
        allsyms = {}
        currentGroupPath = []
        tmpVarCount = 0
        extraLoopDeps = {}
        tmpVarWriteRank = {}
        subQueryCache = {}
    }
    //
    //
    function assign(lhs, op, rhs) {
        let e = expr(lhs.txt + " " + op + " " + rhs.txt, ...lhs.deps, ...rhs.deps)
        e.lhs = lhs
        e.op = op
        e.rhs = rhs
        e.writeSym = lhs.root
        e.deps = e.deps.filter(e1 => e1 != e.writeSym) // remove cycles
        // update sym to rank dep map
        tmpVarWriteRank[e.writeSym] ??= 1
        e.writeRank = tmpVarWriteRank[e.writeSym]
        // if (e.op != "+=") // do not increment for idempotent ops? (XX todo opt)
        tmpVarWriteRank[e.writeSym] += 1
        assignmentStms.push(e)
    }
    //
    //
    //
    function selectUser(a, b) {
        if (exprIsVar(b)) {
            let b1 = b.deps[0]
            let e = expr("for " + b1 + " <- " + a.txt, ...a.deps)
            e.sym = b1
            e.rhs = a.txt
            if (generatorStms.every(e1 => e1.txt != e.txt)) // generator CSE
                generatorStms.push(e)
            allsyms[b1] = true
        }
        return select(a, b)
    }
    //
    //
    // -- Paths (pure) --
    //
    // base path: number (5), string (foo), selection (foo.bar)
    //
    // TODO: add mode flag -- is string allowed? E.g. not lhs of selection,
    //                           i.e. "foo" in api.get("foo","bar")
    //
    // contract: argument p is a Number or String
    //
    // refactored to allow parsing other relevant expressions, such 
    // as data.foo + data.bar or 5 + sum(data.*.val) or ...
    //    
    function path0(p) {
        if (typeof (p) == "number" || !Number.isNaN(Number(p)))  // number?
            return expr(p)
        return path1(parse(p))
    }
    //
    // special path operators: get, apply (TODO!)
    //
    function path1(p) {
        // TODO: assert non null?
        if (typeof (p) == "object" || typeof (p) == "function") { // treat fct as obj
            if (p.xxpath) { // path
                if (p.xxpath == "ident") {
                    return ident(p.xxparam)
                } else if (p.xxpath == "raw") {
                    return expr(p.xxparam)
                } else if (p.xxpath == "get") {
                    let [e1, e2] = p.xxparam
                    if (e2 === undefined) {
                        e2 = e1
                        e1 = { xxpath: "raw", xxparam: "inp" }
                    }
                    // TODO: e1 should never be treated as id!
                    // TODO: vararg?
                    let subQueryPath = subQueryCache[e1] // cache lookup and update
                    if (!subQueryPath) {
                        subQueryPath = path1(e1)
                        let key = JSON.stringify(e1)
                        subQueryCache[key] = subQueryPath
                    }
                    return selectUser(subQueryPath, path1(e2))
                } else if (p.xxpath == "apply") {
                    let [e1, e2] = p.xxparam
                    // TODO: e1 should never be treated as id!
                    return call(path1(e1), path1(e2))
                } else if (p.xxpath == "plus") {
                    let [e1, e2] = p.xxparam
                    return binop("+", path1(e1), path1(e2))
                } else if (p.xxpath == "minus") {
                    let [e1, e2] = p.xxparam
                    return binop("-", path1(e1), path1(e2))
                } else if (p.xxpath == "times") {
                    let [e1, e2] = p.xxparam
                    return binop("*", path1(e1), path1(e2))
                } else if (p.xxpath == "fdiv") {
                    let [e1, e2] = p.xxparam
                    return binop("/", path1(e1), path1(e2))
                } else if (p.xxpath == "div") {
                    let [e1, e2] = p.xxparam
                    return unop("Math.trunc", binop("/", path1(e1), path1(e2)))
                } else if (p.xxpath == "mod") {
                    let [e1, e2] = p.xxparam
                    return unop("Math.trunc", binop("%", path1(e1), path1(e2)))
                } else {
                    error("ERROR - unknown path key '" + p.xxpath + "'")
                    return expr("undefined")
                }
            } else if (p.xxkey) { // reducer (stateful)
                return transStatefulInPath(p)
            } else if (p instanceof Array) {
                print("WARN - Array in path expr not thoroughly tested yet!")
                return transStatefulInPath({ xxkey: "array", xxparam: p })
            } else { // subquery
                //
                // A stateless object literal: we treat individual
                // entries as paths, and build a new object for each
                // series of produced results.
                //
                // We take the combined dependencies of the right-hand
                // side, subtract dependencies of the left-hand side,
                // and use the remaining deps as a key for the resulting
                // object.
                //
                // This means that we'll iterate over all deps(rhs)
                // that aren't also in deps(lhs).
                //
                // Step 1: traverse RHS and gather dependencies
                //
                let entries = {}
                let keydeps = {}
                let rhsdeps = {}
                for (let k of Object.keys(p)) {
                    // flatten, merge, etc.
                    let k1 = path(k)
                    let save = currentGroupPath
                    currentGroupPath = [...currentGroupPath, k1]
                    let rhs1 = path(p[k])
                    currentGroupPath = save
                    entries[k] = { key: k1, rhs: rhs1 }
                    for (let d of k1.deps) keydeps[d] = true
                    for (let d of rhs1.deps) rhsdeps[d] = true
                }
                //
                // Step 2: build new object, aggregating individual
                //         paths and indexed by deps(rhs) - deps(lhs)
                //
                let save = currentGroupPath
                let deps = []
                for (let d in rhsdeps) if (isVar(d) && !(d in keydeps)) deps.push(d)
                let plus = deps.map(ident)
                currentGroupPath = [...currentGroupPath, ...plus]
                let lhs1 = createFreshTempVar(deps)
                assign(lhs1, "??=", expr("{} //!"))
                for (let k of Object.keys(p)) {
                    let { key, rhs } = entries[k]
                    let ll1 = select(lhs1, key)
                    ll1.root = lhs1.root
                    assign(ll1, "=", rhs)
                }
                currentGroupPath = save
                //print("XXX fresh temp var ")
                //inspect({lhs1,entries,deps,plus})
                return lhs1
            }
        } else if (typeof (p) == "number") {
            return path0(p)
        } else {
            // TODO: assert it's a string?
            return path0(String(p))
        }
    }
    function path(p) { return path1(p) }
    //
    //
    // -- Reducers (side effects) --
    //
    //
    function transStatefulInPath(p) {
        return stateful(null, p)
    }
    function transStatefulTopLevel(p) {
        return stateful(null, p)
    }
    //
    //
    function relevantGroupPath(deps) {
        if (!deps)
            return currentGroupPath // no deps given -> not filtering
        //
        let out = []
        for (let e of currentGroupPath) {
            // XXX: we explicitly keep entries with no deps
            // (potential optimization to drop those, but may cause
            // some trouble in scheduling)
            // TODO test this again
            // NOTE tried again, seems to work, except it changes order (e.g. out.total)
            if (!e.deps.length || e.deps.filter(x => deps.indexOf(x) >= 0).length) {
                out.push(e)
            }
        }
        return out
    }
    function entireGroupPathIsRelevant(deps) {
        return currentGroupPath.length == relevantGroupPath(deps).length
    }
    function canDecorrelateGroupPath(deps) {
        return !entireGroupPathIsRelevant(deps)
    }
    function createFreshTempVar(deps) {
        // XXX update loop-to-loop effect dep map
        // when decorrelating, new fresh var should be
        // computed before current loop. Add an extra
        // dependency to loop generator.
        //
        // Example (as done now):
        //
        //  out[data.*A.key] += data.*B.value  (add: *B before *A)
        //
        // Alternative:
        //
        //  tmp += data.*B.value
        //  out[data.*A.key] = tmp (add: tmp before *A)
        //
        // This appears somewhat more desirable, but had the drawback
        // that the entire loop over *A was pulled into loop *B.
        // Hence we currently stick to loop-after-loop dependencies.
        //
        // let allDeps = []
        // for (let e of currentGroupPath) {
        //   for (let x of e.deps)
        //     if (allDeps.indexOf(x) < 0)
        //       allDeps.push(x)
        // }
        // for (let x2 of allDeps) {
        //   for (let x1 of deps) {
        //     if (x1 == x2) continue
        //     if (!extraLoopDeps[x2]) extraLoopDeps[x2] = []
        //     if (extraLoopDeps[x2].indexOf(x1) < 0)
        //       extraLoopDeps[x2].push(x1)
        //   }
        // }
        // if (trace) print("tmp"+tmpVarCount+" ... "+deps+" before "+allDeps)
        // XXX
        //
        let lhs1 = select(expr("tmp"), expr("" + (tmpVarCount++)))
        let root = lhs1.txt
        lhs1.root = root
        lhs1.deps = [root]
        for (let e of relevantGroupPath(deps)) {
            assign(lhs1, "??=", expr("{}"))
            lhs1 = select(lhs1, e)
            lhs1.root = root
        }
        return lhs1
    }
    function openTempVar(lhs, deps) {
        if (lhs && entireGroupPathIsRelevant(deps))
            return lhs
        else
            return createFreshTempVar(deps)
    }
    function closeTempVar(lhs, lhs1) {
        //
        //
        //  let allDeps = []
        //  for (let e of currentGroupPath) {
        //    for (let x of e.deps)
        //      if (allDeps.indexOf(x) < 0)
        //        allDeps.push(x)
        //  }
        //print("alldeps: "+lhs1.deps+" before "+allDeps)
        //
        //
        if (lhs && lhs != lhs1) {
            assign(lhs, "=", lhs1)
            return lhs
        } else {
            return lhs1
        }
    }
    //
    //
    function stateful(lhs, p) {
        //
        // total: api.sum(data.*.value)
        // k:     api.xxkey(xxparam)
        //
        // XXX TODO: check nullish values are dealt with correctly
        //
        if (p.xxkey == "sum") { // sum
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("0"))
            assign(lhs1, "+=", rhs)
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "count") { // count
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("0"))
            assign(lhs1, "+=", expr("1", ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "max") { // max
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("-Infinity"))
            assign(lhs1, "=", expr("Math.max(" + lhs1.txt + "," + rhs.txt + ")", ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "first") { // first
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr(rhs.txt, ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "last") { // last
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "=", expr(rhs.txt + " ?? " + lhs1.txt, ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "join") { // string join
            let rhs = path(p.xxparam)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("''"))
            assign(lhs1, "+=", rhs)
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "array" && p.xxparam.length > 1) { // multi-array
            let rhs = p.xxparam.map(path)
            let lhs2 = openTempVar(lhs,rhs.flatMap(x => x.deps))
            let res1 = []
            for (let e of rhs) {
                let lhs1 = createFreshTempVar(e.deps)
                assign(lhs1, "??=", expr("[]"))
                assign(lhs1, ".push", expr("(" + e.txt + ")", ...e.deps))
                res1.push(lhs1)
            }
            //
            // XXX FIXME: this is *extremely* slow -- we're calling .flat()
            // for every newly created tuple! (but it works...)
            //
            // Better solutions:
            // - have a separate flatten pass at the end
            // - return a proxy object that flattens when iterating
            //
            // In essence, this is a sorting problem (order by rank in outer array).
            // How do we want to implement sorting in general?
            // - separate sortin pass at the end
            // - return a sorted tree that iterates in the right order
            //
            assign(lhs2, "=", expr("[" + res1.map(x => x.txt).join(",") + "].flat()", ...res1.flatMap(x => x.deps)))
            return closeTempVar(lhs, lhs2)
        } else if (p.xxkey == "array") { // array
            let rhs = p.xxparam.map(path)
            let lhs1 = openTempVar(lhs, rhs.flatMap(x => x.deps))
            assign(lhs1, "??=", expr("[]"))
            for (let e of rhs)
                assign(lhs1, ".push", expr("(" + e.txt + ")", ...e.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey) {
            error("ERROR: unknown reducer key '" + p.xxkey + "'")
            return expr("undefined")
        } else if (p instanceof Array) {
            return stateful(lhs, { xxkey: "array", xxparam: p })
        } else if (p instanceof Array) {
            // XXX not using this anymore
            if (p.length > 1) {
                error("ERROR: currently not dealing correctly with multi-element arrays")
                //return expr("undefined")
            }
            let lhs1 = openTempVar(lhs, null)
            assign(lhs1, "??=", expr("[]"))
            let kCount = 0
            for (let k in p) {
                let o = p[k]
                //kCount = api.plus(kCount,api.count(o))
            }
            //
            // XXX: index for multiple sums isn't the right one yet!!
            //
            for (let k in p) {
                let o = p[k]
                kCount = api.plus(kCount, api.count(o))
                //let k0 = path(api.count(o))
                let k1 = path(api.minus(kCount, 1))
                // TODO: support merge/flatten, too?
                let save = currentGroupPath
                currentGroupPath = [...currentGroupPath, k1]
                let ll1 = select(lhs1, k1)
                ll1.root = lhs1.root
                stateful(ll1, o)
                currentGroupPath = save
            }
            return closeTempVar(lhs, lhs1)
        } else if (typeof (p) == "object" && !p.xxpath) {
            //
            // TODO: we don't have the entire rhs, so how to get rhs.deps?
            //
            //   Right now we have no way to decorrelate ...
            //
            let lhs1 = openTempVar(lhs, null)
            assign(lhs1, "??=", expr("{}"))
            let keys = Object.keys(p)
            for (let k of keys) {
                let o = p[k]
                // NOTE: more expressive merge/flatten could traverse
                //       child object (to support multiple keys)
                if (p[k].xxkey == "keyval" || p[k].xxkey == "merge") { // nesting
                    o = p[k].xxparam[1]
                    k = p[k].xxparam[0]
                } else if (p[k].xxkey == "flatten") { // same, but include parent key
                    o = p[k].xxparam[1]
                    k = api.plus(api.plus(k, "-"), p[k].xxparam[0])
                }
                let k1 = path(k)
                let save = currentGroupPath
                currentGroupPath = [...currentGroupPath, k1]
                let ll1 = select(lhs1, k1)
                ll1.root = lhs1.root
                stateful(ll1, o)
                currentGroupPath = save
            }
            return closeTempVar(lhs, lhs1)
        } else {
            // regular path
            let rhs = path(p)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "=", rhs)
            return closeTempVar(lhs, lhs1)
        }
    }

    let res = transStatefulTopLevel(query)
    let ir = { assignmentStms, generatorStms, tmpVarWriteRank, res, query }
    return ir
}