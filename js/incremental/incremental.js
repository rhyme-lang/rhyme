import { api } from "../core.js";


let quoteVar = s => "KEY" + s.replaceAll("*","_star_")

export function generateTriggers(ir) {
    let code = []
    let indent = 0
    function emit(str) {
        if (str.indexOf("}") == 0) indent--
        code.push("".padEnd(indent * 4, ' ') + str)
        if (str.indexOf("{") >= 0) indent++
        if (str.indexOf("}") > 0) indent--
    }

    let generatorStms = [...ir.generators]
    let assignmentStms = ir.assignments

    // emit tmp values at the top
    let remainingAssignmentStms = []
    for (let e of assignmentStms) {
        if (e.deps.length == 0) {
            emit(e.txt)
        } else {
            remainingAssignmentStms.push(e)
        }
    }
    let initCode = [...code]
    code = []
    assignmentStms = [...remainingAssignmentStms] // TODO: might mess up the writeRank dependency

    function emitTrigger() {
        // codegen dependenices (taken from original)
        let tmpInsideLoop = {}
        let tmpAfterLoop = {}
        let tmpAfterTmp = {}
        let loopAfterLoop = {}
        let loopInsideLoop = {} // todo: "not currently used"
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
                if (isloop(v)) tmpInsideLoop[e.writeSym][v] = true // meaning tmp e.writeSym is inside loop v
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
            for (let l1 in tmpInsideLoop[t]) {
                for (let l2 in tmpInsideLoop[t]) {
                    if (l1 != l2 && l1 > l2) {    // TODO: order matters? (i.e., l1 inside l2 or l2 inside l1)
                        loopInsideLoop[l1] ??= {}
                        loopInsideLoop[l1][l2] = true
                    }
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
                    // skip if we already know this is a nested loop
                    if ((loopInsideLoop[l1] && loopInsideLoop[l1][l2]) || (loopAfterLoop[l2] && loopAfterLoop[l2][l1])) {
                        continue
                    }
                    loopAfterLoop[l2][l1] = true
                }
            }
            // TODO: do we need loopAfterTmp? seed loopAfterTmp/Loop from generator.deps?
        }
        let extraLoopDeps = loopAfterLoop

        let availableSyms = {} // currently available in scope (for loops)
        let emittedLoopSyms = {}   // loops that have been fully emitted
        let emittedSymsRank = {}   // number of writes emitted for each sym
        let currOuterLoopSyms = [] // currently active generators (for nested loops)

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
        function outerLoopsAvailable(s) {
            // ready to schedule if all outer loops are emitted, and we are inside the correct scope
            if (!loopInsideLoop[s]) return true
            return Object.keys(loopInsideLoop[s]).every(outer => currOuterLoopSyms.indexOf(outer) >= 0)
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
            let stms = filterAvailable(assignmentStms)
            assignmentStms = filterNotAvailable(assignmentStms)
            for (let e of stms) {
                emit(e.txt)
                emittedSymsRank[e.writeSym] = e.writeRank + 1  // note - dependencies between writes on the same tmp var is tracked via writeRank. Assign stmt only becomes available if prev writeRank is emitted
            }
        }
        function emitGenerators(gntrStms) {
            let gensBySym = {}
            // group generators by symbol
            for (let e of generatorStms) {
                if (!gensBySym[e.sym]) gensBySym[e.sym] = []
                gensBySym[e.sym].push(e)                      // TODO(supun): how can there be multiple generators for the same symbol?
            }
            function symGensAvailable(s) {
                return gensBySym[s].every(depsAvailable) &&
                    extraDepsAvailable(extraLoopDeps[s]) && outerLoopsAvailable(s)
            }
            // compute generators left for inner scope
            // (note - this is to collect genStms that will be (potentially) emitted in an inner scope and make sure we don't mistakenly pass the outer scope genStms to the inner scope)
            generatorStms = []
            for (let s in gensBySym) {
                if (!symGensAvailable(s))
                    generatorStms.push(...gensBySym[s])
            }
            // emit generators
            // (emitting current scope generators)
            for (let s in gensBySym) {
                if (!symGensAvailable(s)) continue
                let [e, ...es] = gensBySym[s] // just pick first -- could be more clever!
                // remove gensBySym[s] from generatorStms (because we are emitting them now)
                generatorStms = generatorStms.filter(e => e.sym != s)

                currOuterLoopSyms.push(s)
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
                currOuterLoopSyms.pop()
                emittedLoopSyms[s] = true
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
    }

    // creating onInsert trigger
    // emit("function onInsert(inp) {")
    emitTrigger()
    // emit("}")

    let insertCode = [...code]
    code = []

    generatorStms = [...ir.generators]
    assignmentStms = [...remainingAssignmentStms]

    // TODO: reverse the aggregate ops (e.g., += to -=, etc.)
    let updatedAssignmentStms = []
    for (let e of assignmentStms) {
        if (e.op == "+=") {
            e.op = "-="
            e.txt = e.txt.replace("+=", "-=")
            updatedAssignmentStms.push(e)
        } else if (e.op == "??=") {
            // skipping ??= for the moment
            continue
        } else {
            updatedAssignmentStms.push(e)
        }
    }
    assignmentStms = updatedAssignmentStms

    // TODO: change ??= to delete if zero?

    // emit("function onDelete(inp) {")
    emitTrigger()
    // emit("}")
    let deleteCode = [...code]

    return [initCode.join("\n"), insertCode.join("\n"), deleteCode.join("\n")]
}

// let query = {
//     "data.*.key": api.sum("data.*.value")
// }

// let query2 = {
//     total: api.sum("data.*.value"),
//     "data.*.key": api.sum("data.*.value")
// }

// let ir = api.getIR(query2)
// let [initCode, insertCode, deleteCode] = generateTriggers(ir)

// let tmp = {}

// console.log(initCode)
// console.log(insertCode)
// console.log(deleteCode)

// eval(initCode)

// let inp = {}
// inp["data"] = [{ key: "A", value: 10 }]
// eval(insertCode)

// inp["data"] = [{ key: "A", value: 25 }]
// eval(insertCode)

// console.log(tmp[0])