const { quoteVar, debug, trace, print, inspect} = require("./utils")

exports.generate = (ir) => {
    let assignmentStms = ir.assignmentStms
    let generatorStms = ir.generatorStms
    let tmpVarWriteRank = ir.tmpVarWriteRank
    let res = ir.res
    //
    // debug information
    //
    let explain = {}
    explain.src = ir.query

    //
    // init codegen
    //
    let code = []
    let indent = 0
    function emit(str) {
        if (str.indexOf("}") == 0) indent--
        code.push("".padEnd(indent * 4, ' ') + str)
        if (str.indexOf("{") >= 0) indent++
        if (str.indexOf("}") > 0) indent--
    }
    emit("inp => {")
    emit("let tmp = {}")
    if (debug) {
        print("---- begin code ----")
        for (let e of assignmentStms)
            if (e.txt.indexOf("??=") < 0) // skip init stms
                print(e.txt + "  // " + e.writeSym + " #" + e.writeRank + " <- " + e.deps)
        print("return " + res.txt)
        print("---- end code ----")
    }
    explain.ir = {}
    explain.ir.assignments = [...assignmentStms]
    explain.ir.generators = [...generatorStms]
    let generatorStmsCopy = [...generatorStms] // TODO(supun): temporary fix
    //
    // Fix explicit loop ordering (added 11/28):
    //
    //    tmp0 <- *A
    //    tmp1 <- *tmp0, *B
    //
    // means: *A before *B
    //
    // It's not quite sufficient to say "tmp0 before *B" because
    // that might suck the *B loop into the *A loop (right after
    // the write to tmp0).
    //
    // Possible refinement:
    //
    // NOTE: we're currently treating tmp's as atomic (all writes)
    // together. This is probably too coarse when we want to deal
    // with, say, largely independent queries composed into a
    // single object.
    //
    // IDEA: distinguish tmp0#1, tmp0#2, i.e., take write rank
    // into account (proper SSA form).
    //
    let tmpInsideLoop = {}
    let tmpAfterLoop = {}
    let tmpAfterTmp = {}
    let loopAfterLoop = {}
    let loopInsideLoop = {} // todo: "not currently used" -- essentially, anything that's not loopAfterLoop

    //
    // compute tmpInsideLoop and tmpAfterTmp
    //
    for (let e of assignmentStms) {
        //if (e.txt.indexOf("??=") < 0) { // skip init stms (??)
        let isloop = s => s.startsWith("*")
        let istmp = s => s.startsWith("tmp")
        tmpInsideLoop[e.writeSym] ??= {}
        tmpAfterTmp[e.writeSym] ??= {}
        for (let v of e.deps) {
            if (isloop(v)) tmpInsideLoop[e.writeSym][v] = true
            if (istmp(v)) tmpAfterTmp[e.writeSym][v] = true
        }
        //}
    }
    //
    // compute tmpAfterLoop
    //
    for (let t2 in tmpAfterTmp) {
        tmpAfterLoop[t2] ??= {}
        // gather loop prior tmps are in
        for (let t1 in tmpAfterTmp[t2]) {
            for (let l in tmpInsideLoop[t1])
                tmpAfterLoop[t2][l] = true
        }
        // remove own loops
        for (let l in tmpInsideLoop[t2])
            delete tmpAfterLoop[t2][l]
    }
    //
    // compute loopInsideLoop
    //
    for (let t in tmpInsideLoop) {
        for (let l2 in tmpInsideLoop[t]) {
            loopInsideLoop[l2] ??= {}
            for (let l1 in tmpInsideLoop[t]) {
                loopInsideLoop[l2][l1] = true
                loopInsideLoop[l1] ??= {}
                loopInsideLoop[l1][l2] = true
            }
        }
    }
    //
    // compute loopAfterLoop
    //
    for (let t in tmpAfterLoop) {
        for (let l2 in tmpInsideLoop[t]) {
            loopAfterLoop[l2] ??= {}
            for (let l1 in tmpAfterLoop[t]) {
                // if not in loopInsideLoop, then l1 before l2
                if (!loopInsideLoop[l2] || !loopInsideLoop[l2][l1])
                    loopAfterLoop[l2][l1] = true
            }
        }
        // TODO: do we need loopAfterTmp? seed loopAfterTmp/Loop from generator.deps?
    }

    explain.dependencies = { tmpInsideLoop, tmpAfterTmp, tmpAfterLoop, loopAfterLoop, loopInsideLoop }
    let extraLoopDeps = loopAfterLoop
    if (debug) {
        inspect({ tmpInsideLoop, tmpAfterTmp, tmpAfterLoop, loopAfterLoop, loopInsideLoop })
        print("---- end dependency data ----")
    }
    //
    //
    let availableSyms = {} // currently available in scope (for loops)
    let emittedLoopSyms = {}   // loops that have been fully emitted
    let emittedSymsRank = {}   // number of writes emitted for each sym
    function isAvailable(s) {
        if (s == "inp")
            return true
        if (s.startsWith("*"))
            return availableSyms[s]
        if (s.startsWith("tmp"))
            return emittedSymsRank[s] == tmpVarWriteRank[s] // all writes emitted
        return false
    }
    function depsAvailable(e) {
        return e.deps.every(isAvailable)
    }
    function extraDepsAvailable(depMap) {
        return (Object.keys(depMap)).every(s => emittedLoopSyms[s])
    }
    function loopsFinished(e) {
        return extraDepsAvailable(tmpAfterLoop[e.writeSym])
    }
    function filterAvailable(stms) {
        return stms.filter(e => depsAvailable(e) && loopsFinished(e))
    }
    function filterNotAvailable(stms) {
        return stms.filter(e => !depsAvailable(e) || !loopsFinished(e))
    }
    function emitAssignments() {
        // XXX Note: need to call this multiple times,
        // as emitting stms makes others available
        // TODO: refactor?
        let stms = filterAvailable(assignmentStms)
        assignmentStms = filterNotAvailable(assignmentStms)
        for (let e of stms) {
            emit(e.txt)
            emittedSymsRank[e.writeSym] = e.writeRank + 1
        }
    }
    function emitGenerators(gntrStms) {
        // symbol available <=> all its generators are available
        // symbol available ? emit loop here : schedule in inner scope
        //
        // 1. group generators by symbol
        // 2. emit loops for available symbols here
        // 3. recurse to emit nested loops as they become available
        //
        // Note: this is like LMS scheduling. Go outside in, pick
        // what should live at current level. Assume that each loop
        //
        //    ** EMITTED EXACTLY ONCE **.
        //
        // We have 3 levels of dependencies:
        //
        // - assignment or generator to loop var or temporary (true data dep, raw)
        //    - if dep on temporary, really means the final value (rank), after all writes
        // - assignment on previous assignment (write after write)
        //    - synced by rank per temporary
        // - loop after loop (read after write), e.g. loop *B before loop *A
        //    - without this, we'd fill loops half and then detect order is wrong
        //
        // Note that kind 1 (generator on loop var dep) really only
        // covers dependency of one generator on another -- not of
        // one loop body on another generator!
        //
        // This means we're missing cases such as
        //
        //    data.*A.key -> data.*B.value
        //
        // because there is no dependency between *A and *B. Yet,
        // we have to generate a nested loop to make this work.
        //
        // (Of course only if we don't decorrelate!)
        //
        // Issues:
        //
        //  - We can of course force loops to be nested by
        //    lifting dependencies from assignments to gens.
        //  - But we also may have assignments that should
        //    *not* live in the nested loop!
        //
        //    So a generator may occur both in nested and
        //    top level position.
        //
        //
        // TODO: refinements
        // + uncorrelated loops
        //    - data.*A.key -> sum(data.*B.value)
        //    - XX: done by emitting temp var above
        // + generate 0 sum if no elements
        //    - total: sum(empty.*.value)
        //    - XX: done now, by emitting two assignments above
        // - loop fusion
        //    - same level, two generators with identical rhs
        //        for *A <- in.data ... for *B <- in.data
        // - direct cycles
        //    - data.*.foo.*.bar
        // - indirect cycles
        //    - data.*A.foo.*B.bar ... other.*B.baz.*A.boo
        //
        //
        let gensBySym = {}
        // group generators by symbol
        for (let e of generatorStms) {
            if (!gensBySym[e.sym]) gensBySym[e.sym] = []
            gensBySym[e.sym].push(e)
        }
        function symGensAvailable(s) {
            return gensBySym[s].every(depsAvailable) &&
                extraDepsAvailable(extraLoopDeps[s])
        }
        // compute generators left for inner scope
        generatorStms = []
        let availableGenSyms = {} // to prevent nesting unwanted generators
        for (let s in gensBySym) {
            if (!symGensAvailable(s))
                generatorStms.push(...gensBySym[s])
            else
                availableGenSyms[s] = true
        }
        // emit generators (only available ones)
        for (let s in availableGenSyms) {
            if (!symGensAvailable(s)) continue
            let [e, ...es] = gensBySym[s] // just pick first -- could be more clever!
            // remove gensBySym[s] from generatorStms (we're emitting it now)
            generatorStms = generatorStms.filter(e => e.sym != s)
            // loop header
            emit("for (let " + quoteVar(e.sym) + " in " + e.rhs + ") {")
            // filters
            for (let e1 of es) {
                emit("if (!" + e1.rhs + "[" + quoteVar(e1.sym) + "]) continue")
            }
            // recurse!
            availableSyms[s] = true
            emitConvergence()
            // XX here: nested loops
            // figure out which statements need nested loops
            // XX done
            delete availableSyms[s]
            emit("}")
            emittedLoopSyms[s] = true
            emitAssignments() // any assignments that became available (temp after loop)
        }
    }
    function emitConvergence() {
        // emit assignments + generator as long as we're making progress
        // (assignments may need multiple calls b/c effect deps)
        let codeLength
        do {
            do {
                codeLength = code.length
                emitAssignments()
            } while (codeLength < code.length)
            emitGenerators()
        } while (codeLength < code.length)
    }
    // XXX
    emitConvergence()

    // TODO(supun): hack!! for generators that need to be emitted multiple times
    //              look at test/advanced.js: this is needed when accessing "reified intermediates"
    if (assignmentStms.length > 0) {
        print("WARN - re-emitting generators because assignments remaining")
        emit("// --- repeated generators ---")
        // if assignments remaining, re-generate the generators required and emit the symbols
        let gensBySym = {}
        for (let e of generatorStmsCopy) {
            if (!gensBySym[e.sym]) gensBySym[e.sym] = []
            gensBySym[e.sym].push(e)
        }

        // right not emitting generators required per assignment (very naive!)
        // (i.e., not sharing generators even if possible)
        for (let e of assignmentStms) {
            // emit the corresponding generators
            let neededGens = {}
            e.deps.filter(s => s.startsWith("*")).forEach(s => neededGens[s] = true)
            for (let s in neededGens) {
                emit("for (let " + quoteVar(s) + " in " + gensBySym[s][0].rhs + ") {")
            }
            emit(e.txt)
            for (let s in neededGens) {
                emit("}")
            }
        }
        assignmentStms = [] // we have emitted all remaining assignments
    }

    if (assignmentStms.length) {
        print("ERROR - couldn't emit the following assignments (most likely due to circular dependencies:")
        for (let e of assignmentStms) {
            print(e.txt + " ---- " + e.deps)
        }
    }
    //
    // wrap up codegen
    //
    emit("return " + res.txt)
    emit("}")
    if (trace)
        code.forEach(s => print(s))
    let codeString = code.join("\n")
    let queryFunc = eval(codeString)
    queryFunc.explain = explain
    queryFunc.explain.code = code
    //queryFunc.explain.codeString = codeString
    //
    // execute
    //
    return queryFunc
}