const { quoteVar, debug, trace, print, inspect, error, warn } = require("./utils")
const { parse } = require("./parser")
const { ops, ast } = require("./shared")
const { resolveHole } = require("./preprocess")


let quoteConst = e => {
    if (typeof e === "boolean") {
        return String(e)
    } else if (typeof e === "number") {
        return String(e)
    } else if (typeof e === "string") {
        return '"'+e+'"'
    } else if (typeof e === "object" && e instanceof Array && e.length == 0) {
        return "[]"
    } else if (typeof e === "object" && Object.keys(e).length == 0) {
        return "{}"
    } else {
        error("ERROR - unsupported constant: "+e)
    }
}


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
    let select = (a, b) => {
        let b1 = b.txt.match(/'([a-zA-Z_][a-zA-Z_0-9]*)'/)
        if (b1)
            return expr(a.txt + "." + b1[1], ...a.deps, ...b.deps)
        else
            return expr(a.txt + "[" + b.txt + "]", ...a.deps, ...b.deps)
    }
    let call = (a, ...b) => expr("" + a.txt + "(" + b.map(x=>x.txt).join(",") + ")", ...a.deps, ...b.map(x=>x.deps).flat())
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
    // special path operators: get, apply, ...
    //
    function path(p) {
        if (p.xxkey == "ident") {
            return ident(p.xxop)
        } else if (p.xxkey == "raw") {
            return expr(p.xxop)
        } else if (p.xxkey == "const") {
            return expr(quoteConst(p.xxop))
        } else if (p.xxkey == "get") {
            let [e1, e2] = p.xxparam
            if (e2 === undefined) { // XXX redundant with desugar?
                e2 = e1
                e1 = { xxkey: "raw", xxop: "inp" }
            }
            // TODO: e1 should never be treated as id!
            // TODO: vararg?
            let key = JSON.stringify(e1)
            let subQueryPath = subQueryCache[key] // cache lookup and update
            if (!subQueryPath) {
                subQueryPath = path(e1)
                // anytime we have f(x).a we know that f returns a collection,
                // hence likely won't be cheap (e.g. string split, array flatten, ...)
                // --> CSE it into a temp variable
                if (e1.xxkey == "apply") {
                    let lhs1 = createFreshDirectTempVar(subQueryPath.deps)
                    assign(lhs1, "=", subQueryPath)
                    subQueryPath = lhs1
                }
                subQueryCache[key] = subQueryPath
            }
            return selectUser(subQueryPath, path(e2))
        } else if (p.xxkey == "apply") {
            let [e1, ...es2] = p.xxparam
            // XXX: multiple args vs currying?
            return call(path(e1), ...es2.map(path))
        } else if (p.xxkey == "plus") {
            let [e1, e2] = p.xxparam
            return binop("+", path(e1), path(e2))
        } else if (p.xxkey == "minus") {
            let [e1, e2] = p.xxparam
            return binop("-", path(e1), path(e2))
        } else if (p.xxkey == "times") {
            let [e1, e2] = p.xxparam
            return binop("*", path(e1), path(e2))
        } else if (p.xxkey == "fdiv") {
            let [e1, e2] = p.xxparam
            return binop("/", path(e1), path(e2))
        } else if (p.xxkey == "div") {
            let [e1, e2] = p.xxparam
            return unop("Math.trunc", binop("/", path(e1), path(e2)))
        } else if (p.xxkey == "mod") {
            let [e1, e2] = p.xxparam
            return unop("Math.trunc", binop("%", path(e1), path(e2)))
        } else if (p.xxkey == "and") {
            let [e1, e2] = p.xxparam
            return binop("&&", path(e1), path(e2))
        } else if (ops.stateful[p.xxkey]) { // reducer (stateful)
            return transStatefulInPath(p)
        } else if (p.xxkey == "hole") {
            return path(resolveHole(p.xxop))
        } else {
            error("ERROR - unknown path key '" + p.xxkey + "'")
            return expr("undefined")
        }
    }

    //
    // -- Special case for objects in paths --
    function transObjectInPath(p) {
        console.assert(p.xxkey == "object")
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
        // NOTE (bugfix): We have to be careful that we consider
        // only deps(lhs) - deps(current), i.e., we want to
        // preserve any deps that are already in the current path.
        //
        // Step 1: traverse RHS and gather dependencies
        //
        let entries = {}
        let keydeps = {}
        let rhsdeps = {}
        for (let i = 0; i < p.xxparam.length; i += 2) {
            let k = p.xxparam[i]
            let o = p.xxparam[i+1]
            // NOTE: more expressive merge/flatten could traverse
            //       child object (to support multiple keys)
            if (o.xxkey == "keyval" || o.xxkey == "merge") { // nesting
                k = o.xxparam[0]
                o = o.xxparam[1]
            } else if (o.xxkey == "flatten") { // same, but include parent key
                k = api.plus(api.plus(k, "-"), o.xxparam[0])
                o = o.xxparam[1]
            }
            let k1 = path(k)
            let save = currentGroupPath
            currentGroupPath = [...currentGroupPath, k1]
            let rhs1 = path(o)
            currentGroupPath = save
            entries[i] = { key: k1, rhs: rhs1 }
            for (let d of k1.deps) keydeps[d] = true
            for (let d of rhs1.deps) rhsdeps[d] = true
        }
        //
        // Step 2: build new object, aggregating individual
        //         paths and indexed by deps(rhs) - (deps(lhs)-deps(current))
        //
        let save = currentGroupPath

        let curdeps = {}
        for (let d of currentGroupPath) for (let e of d.deps) curdeps[e] = true
        let newkeydeps = {}
        for (let d in keydeps) if (!(d in curdeps)) newkeydeps[d] = true
        let newrhsdeps = []
        for (let d in rhsdeps) if (isVar(d) && !(d in newkeydeps)) newrhsdeps.push(d)
        // remove overlap with currentGroupPath
        let plus = filterKeysFromGroupPath(newrhsdeps.map(ident))

        let deps = [] // result deps is union of key and val deps
        for (let d in rhsdeps) if (isVar(d)) deps.push(d)
        for (let d in keydeps) if (isVar(d)) deps.push(d)

        currentGroupPath = [...currentGroupPath, ...plus]
        let lhs1 = createFreshTempVar(deps)
        assign(lhs1, "??=", expr("{}"))
        for (let i = 0; i < p.xxparam.length; i += 2) {
            let k = p.xxparam[i]
            let o = p.xxparam[i+1]
            // NOTE: more expressive merge/flatten could traverse
            //       child object (to support multiple keys)
            if (o.xxkey == "keyval" || o.xxkey == "merge") { // nesting
                k = o.xxparam[0]
            } else if (o.xxkey == "flatten") { // same, but include parent key
                k = api.plus(api.plus(k, "-"), o.xxparam[0])
            }
            let { key, rhs } = entries[i]
            let ll1 = select(lhs1, key)
            ll1.root = lhs1.root
            // Note: if the subquery rhs is a groupby where both the key and value depends
            //       on a generator x, deps will not contain x.
            //       As a result, the TempVar to store the subquery (rhs) will not
            //       depend on generator x.
            //       This may generate incorrect code, as rhs will be mutated inside loop x.
            //       but the assignment only copies the reference of rhs.
            //       As an example, look at test subQueryGrouping in fixme.test.js
            // (seems fixed, but leaving note intact for the moment as reminder)
            assign(ll1, "=", rhs)
        }
        currentGroupPath = save
        //print("XXX fresh temp var ")
        //inspect({lhs1,entries,deps,plus})
        return lhs1
    }

    //
    // -- Reducers (side effects) --
    //
    //
    function transStatefulInPath(p) {
        if (p.xxkey == "object")
            return transObjectInPath(p)
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
            if (!e.deps.length || e.deps.some(x => deps.indexOf(x) >= 0)) {
                out.push(e)
            }
        }
        return out
    }
    function entireGroupPathIsRelevant(deps) {
        return currentGroupPath.length == relevantGroupPath(deps).length
    }
    function filterKeysFromGroupPath(newKeys) {
        // possible refinement: drop new keys that are *implied* by deps of current path
        // (TODO try this, but unlikely to work given current logic in path1)
        return newKeys.filter(x => !currentGroupPath.some(k => x.txt == k.txt))
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
        let lhs1 = select(expr("tmp"), ident("t" + (tmpVarCount++)))
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
    function createFreshDirectTempVar(deps) {
        // this is not a group-by accumulator! create a temp var
        // that is directly indexed by deps (nothing less, nothing more)
        // TODO: remove duplicate deps?
        let lhs1 = select(expr("tmp"), ident("t" + (tmpVarCount++)))
        let root = lhs1.txt
        lhs1.root = root
        lhs1.deps = [root]
        let extra = deps.filter(isVar)
        // NOTE: as a first approximation, these variables are
        // well scoped and only depend on a specific set of loop
        // variables, so it would seem that it's enough to *depend*
        // on these vars (force placement inside loops) like this:
        //     lhs1.deps.push(...extra)
        // This often works but not all the time: sometimes the loop
        // gets split (see "repeated generators" in output) and in that
        // case, state from each loop iteration must be preserved
        // (see AOC day3-part1 -- it still produces correct result,
        // but fails when replacing tmp[1] with its own let tmp1,
        // demonstrating the scoping issue more clearly).
        //
        // So in the general case (one could try to check and
        // optimize but loop splitting information is only available
        // at codegen), we're stuck with this:
        for (let e of extra) {
            assign(lhs1, "??=", expr("{}"))
            lhs1 = select(lhs1, ident(e))
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
        if (p.xxkey == "sum") { // sum
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("0"))
            assign(lhs1, "+=", rhs)
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "product") { // sum
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("1"))
            assign(lhs1, "*=", rhs)
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "count") { // count
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("0"))
            assign(lhs1, "+=", expr("1", ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "min") { // min
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("Infinity"))
            assign(lhs1, "=", expr("Math.min(" + lhs1.txt + "," + rhs.txt + ")", ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "max") { // max
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr("-Infinity"))
            assign(lhs1, "=", expr("Math.max(" + lhs1.txt + "," + rhs.txt + ")", ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "first") { // first
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "??=", expr(rhs.txt, ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "last" || p.xxkey == "single") { // last -- XXX single is a hack...
            let rhs = path(p.xxparam[0])
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "=", expr(rhs.txt + " ?? " + lhs1.txt, ...rhs.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "join") { // string join
            let rhs = path(p.xxparam[0])
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
            // - separate sorting pass at the end
            // - return a sorted tree that iterates in the right order
            //
            assign(lhs2, "=", expr("[" + res1.map(x => x.txt).join(",") + "].flat()", ...res1.flatMap(x => x.deps)))
            return closeTempVar(lhs, lhs2)
        } else if (p.xxkey == "array" && p.xxparam.length > 1) { // alternative, no longer used ...
            warn("WARNING: currently not dealing correctly with multi-element arrays")
            let lhs1 = openTempVar(lhs, null)
            assign(lhs1, "??=", expr("[]"))
            let kCount = 0
            for (let k in p.xxparam) {
                let o = p.xxparam[k]
                //kCount = api.plus(kCount,api.count(o))
            }
            //
            // XXX: index for multiple sums isn't the right one yet!!
            //
            for (let k in p.xxparam) {
                let o = p.xxparam[k]
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
        } else if (p.xxkey == "array") { // array
            let rhs = p.xxparam.map(path)
            let lhs1 = openTempVar(lhs, rhs.flatMap(x => x.deps))
            assign(lhs1, "??=", expr("[]"))
            for (let e of rhs)
                assign(lhs1, ".push", expr("(" + e.txt + ")", ...e.deps))
            return closeTempVar(lhs, lhs1)
        } else if (p.xxkey == "object") { // object
            //
            // TODO: we don't have the entire rhs, so how to get rhs.deps?
            //
            //   Right now we have no way to decorrelate ...
            //
            let lhs1 = openTempVar(lhs, null)
            assign(lhs1, "??=", expr("{}"))
            for (let i = 0; i < p.xxparam.length; i += 2) {
                let k = p.xxparam[i]
                let o = p.xxparam[i+1]
                // NOTE: more expressive merge/flatten could traverse
                //       child object (to support multiple keys)
                if (o.xxkey == "keyval" || o.xxkey == "merge") { // nesting
                    k = o.xxparam[0]
                    o = o.xxparam[1]
                } else if (o.xxkey == "flatten") { // same, but include parent key
                    k = api.plus(api.plus(k, "-"), o.xxparam[0])
                    o = o.xxparam[1]
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
        } else if (ops.stateful[p.xxkey]) {
            error("ERROR: unknown reducer key '" + p.xxkey + "'")
            return expr("undefined")
        } else if (p.xxkey == "hole") {
            return stateful(lhs, resolveHole(p.xxop))
        } else {
            // regular path
            let rhs = path(p)
            let lhs1 = openTempVar(lhs, rhs.deps)
            assign(lhs1, "=", rhs)
            return closeTempVar(lhs, lhs1)
        }
    }

    console.assert(query && query.xxkey && !query.rhyme_ast)
    let res = transStatefulTopLevel(query)
    let ir = { assignmentStms, generatorStms, tmpVarWriteRank, res, query }
    return ir
}