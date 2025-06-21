const { pretty } = require("./prettyprint");
const { typing, props } = require("./typing");
const { runtime } = require("./simple-runtime");
const { sets } = require("./shared");

let optimizer = {}
exports.optimizer = optimizer;

let getSize = (q) => {
    if(q.arg)
        return q.arg.map(getSize).reduce((prev, curr) => prev + curr, 1);
    return 1;
}

let deduplicate = (q, cseMap) => {
    let qString = JSON.stringify(q);
    if(cseMap[qString])
        return cseMap[qString];
    cseMap[qString] = q;
    if(q.arg)
        q.arg = q.arg.map(arg => deduplicate(arg, cseMap));
    return q;
}
optimizer.deduplicate = deduplicate;

let getConstantObjectExp = (q) => {
    if(q.key == "const")
        return q.op;
    if(q.key != "update")
        return {};
    let prevObj = getConstantObjectExp(q.arg[0]);
    let keyExp = q.arg[1];
    let valExp = q.arg[2];
    if(!(keyExp && keyExp.key == "const")) {
        let newObj = {};
        if(keyExp.schema) { // If typing is enabled, check for intersections.
            for(let key of Object.keys(prevObj)) {
                if(typing.typeDoesntIntersect(key.schema.type, keyExp.schema.type)) {
                    newObj[key] = prevObj[key];
                }
            }
        }
        return newObj;
    }
    // genExp exists and first arg is mkset.
    let keyValue = keyExp.op;
    return {...prevObj, [keyValue]: valExp};
}

let constantFold = (q) => {
    if(q.schema && !q.schema.props.includes(props.nothing) && typeof q.schema.type === "string") {
        return {
            ...q,
            key: "const",
            op: q.schema.type,
        };
    }
    if(q.arg)
        q.arg = q.arg.map(constantFold);
    if (q.key === "get") {
        if(q.arg[1].key == "const") {
            let constObjPart = getConstantObjectExp(q.arg[0])
            let key = q.arg[1].op;
            if(constObjPart[key]) {
                return constObjPart[key];
            }
        }
    } else if (q.key === "pure") {
        if (q.op == "and") {
            if (q.arg[0].schema && !q.arg[0].schema.props.includes(props.nothing)) {
                return {
                    ...q,
                    arg: [avoidEvaluation(q.arg[0]), q.arg[1]]
                };
            }
            if (q.arg[0].key == "const" && q.arg[0].op === undefined) {
                return {
                    ...q,
                    key: "const",
                    op: undefined
                };
            }
            return q;
        } else if (q.op == "orElse") {
            if (q.arg[0].key == "const") {
                if(q.arg[0].op === undefined) {
                    return q.arg[1];
                } else {
                    return q.arg[0];
                }
            }
            return q;
        } else if (q.op === "equal" || q.op === "notEqual" || q.op === "fdiv" || q.op == "concat" ||
            q.op === "plus" || q.op === "minus" || q.op === "times" || q.op === "div" || q.op === "mod") {
            if(q.arg[0].key == "const" && q.arg[1].key == "const") {
                let val1 = q.arg[0].op;
                let val2 = q.arg[1].op;
                let res;
                res = runtime.pure[q.op](val1, val2);
                return {
                    ...q,
                    key: "const",
                    op: res
                }
            }
        }
    } else if (q.key === "stateful") {
        if (q.op === "print")
            return q;
        if (q.op == "array")
            return q;
        if (q.op == "mkset")
            return q;
        if(q.arg[0].key == "const" && (q.op == "single" || q.bnd.length == 0)) {
            // If const, then it can't be "nothing".
            // Must not be bound over specific variable, otherwise cardinality can't be known.
            // But for single, only one value is needed, hence it will be valid.
            return {
                ...q,
                key: "const",
                op: runtime.stateful[q.op](undefined)(q.arg[0].op)
            };
        }
        // TODO: X & Y observation. Can reduce stateful(X & Y) to X & stateful(Y) in certain circumstances.
        return q;
    }
    return q;
}
optimizer.constantFold = constantFold;

// Return an expression that retains the same nothing properties and variables.
// However, without regard to the resulting value, because it will not be used.
let avoidEvaluation = (q) => {
    if(q.key == "const")
        return q;
    if((!q.arg || q.vars.length == 0) && !q.schema.props.includes(props.nothing)) {
        return {
            ...q,
            key: "const",
            op: 1,
            arg: []
        };
    }
    if(!q.schema.props.includes(props.nothing)) {
        return {
            ...q,
            key: "const",
            op: 1,
            arg: []
        };
        // Since optimizations happen after generators are extracted, they don't need to be maintained, with the below code.

        // Evaluation is unnecessary, but generators must still be maintained when optimization is done early
        // As such, avoid evaluation of everything, except for generator expressions.
        /*
        if(q.key === "get" && (q.arg[1].key === "var" || q.arg[1].key === "vars") && q.mode !== "maybe") {
            return q;
        } else {
            let newArgs = q.arg.map((arg) => avoidEvaluation(arg));
            let necessaryArgs = newArgs.filter((arg) => arg.key !== "const");
            if(necessaryArgs.length == 0)
                return {
                    ...q,
                    key: "const",
                    op: 1,
                    arg: []
                };
            if(q.key == "stateful") {
                return {
                    ...q,
                    key: "stateful",
                    op: "count",
                    arg: necessaryArgs
                };
            }
            if(q.key == "update") {
                return q;
            }
            if(necessaryArgs.length == 1)
                return necessaryArgs[0];
            let prevVal = necessaryArgs[0];
            for(let i = 1; i < necessaryArgs.length; i++) {
                prevVal = {
                    ...q,
                    key: "pure",
                    op: "orElse",
                    arg: [prevVal, necessaryArgs[i]]
                };
            }
            return prevVal;
        }*/
    }
    if(q.key == "pure") {
        if(q.op == "and" || q.op == "andAlso") {
            // Logical conjunction of nothing properties
            if(!isArgumentNecessary(q.arg[0]))
                return avoidEvaluation(q.arg[1]);
            if(!isArgumentNecessary(q.arg[1]))
                return avoidEvaluation(q.arg[0]);
            return {
                ...q,
                arg: [
                    avoidEvaluation(q.arg[0]),
                    avoidEvaluation(q.arg[1])
                ]
            };
        } else if (q.op === "equal" || q.op === "notEqual" ||
                    q.op === "lessThan" || q.op === "greaterThan" ||
                    q.op === "lessThanOrEqual" || q.op === "greaterThanOrEqual") {
            // In order to determine if nothing is returned, the exact value of the arguments are necessary to be obtained.
            // TOOD: X = X is always true.
            return {
                ...q,
                arg: [
                    optimizer.shrinking(q.arg[0]),
                    optimizer.shrinking(q.arg[1])
                ]
            };
        } else {
            
            // Logical disjunction of nothing properties
            // TODO: Is there any other form? (Answer: Yes, functions that return boolean false can yield nothing).
            let argList = [];
            for(let argI in q.arg) {
                let arg = q.arg[argI];
                if(!isArgumentNecessary(arg))
                    continue;
                argList.push(avoidEvaluation(arg));
            }
            // If only 1 value can be nothing, only evaluate that value.
            if(argList.length == 1)
                return argList[0];
            let prevVal = argList[0];
            for(let i = 1; i < argList.length; i++) {
                prevVal = {
                    ...q,
                    key: "pure",
                    op: "orElse",
                    arg: [prevVal, argList[i]]
                };
            }
            return prevVal;
        }
        return q;
    } else if(q.key == "stateful") {
        // The "all" aggregator has a conjunction nature, versus other aggregator's disjunction nature (when only in maybe mode).
        if (q.op == "all") {
            // For the conjunction aggregator of "all", all values must be defined for the result to be defined.
            // Therefore, the "all" aggregator is used.
            return {
                ...q,
                key: "stateful",
                op: "all",
                arg: [avoidEvaluation(q.arg[0])]
            };
        } else {
            // For a disjunction aggregator, finding a singular non-nothing value is enough.
            // Therefore, the "any" aggregator is used.
            return {
                ...q,
                key: "stateful",
                op: "any",
                arg: [avoidEvaluation(q.arg[0])]
            }
        }
    }
    return q;
}
let isArgumentNecessary = (q) => {
    if(q.schema.props.includes(props.nothing))
        return true;
    return false;
}

let deadCodeElimination = (q) => {
    if (q.arg)
        q.arg = q.arg.map(deadCodeElimination);
    if (q.key === "input") {
        return q;
    } else if (q.key === "loadInput") {
        return q;
    } else if (q.key === "const") {
        return q;
    } else if (q.key === "var") {
        return q;
    } else if (q.key === "get") {
        if(q.arg[1].key == "const") {
            let constObjPart = getConstantObjectExp(q.arg[0])
            let key = q.arg[1].op;
            if(constObjPart[key]) {
                return constObjPart[key];
            }
        }
        return q;
    } else if (q.key === "pure") {
        if (q.op == "and" || q.op == "andAlso") {
            // If the first argument is never nothing, then there's no need to evaluate it.
            if(q.arg[0].schema && !q.arg[0].schema.props.includes(props.nothing))  {
                return q.arg[1];
            } else {
                let newArg = avoidEvaluation(q.arg[0]);
                return {
                    ...q,
                    key: "pure",
                    arg: [newArg, q.arg[1]]
                };
            }
        } else if (q.op == "orElse") {
            // If the first argument is never nothing, there's no need to calculate the second arg.
            if(q.arg[0].schema && !q.arg[0].schema.props.includes(props.nothing)) {
                return q.arg[0];
            } else {
                return q;
            }
        }
    } else if (q.key === "hint") {
        return q;
    } else if (q.key === "mkset") {
        return q;
    } else if (q.key === "stateful") {
        if (q.op === "print")
            return q;
        if (q.op == "array")
            return q;
        // If the aggregator isn't aggregating over anything, just propagate the value through.
        if (q.op == "count") {
            if (q.bnd.length == 0) {
                return avoidEvaluation(q.arg[0]);
            } else {
                return {
                    ...q,
                    key: "stateful",
                    op: "count",
                    arg: [avoidEvaluation(q.arg[0])]
                };
            }
        }
        if (q.bnd.length == 0) {
            if(q.op == "sum" || q.op == "product") {
                // If default value need not be considered.
                if(q.mode == "maybe" || !q.schema.props.includes(props.nothing)) {
                    return q.arg[0];
                } else {
                    // Otherwise, need to get default value for possibility of nothing.
                    let defaultVal = {
                        key: "const",
                        op: runtime.stateful[q.op + "_init"](),
                    };
                    return {
                        ...q,
                        key: "pure",
                        op: "orElse",
                        arg: [q.arg[0], defaultVal]
                    };
                }
            } else if(q.op == "count") {
                // If value is guaranteed to exist (not nothing).
                if(!q.schema.props.includes(props.nothing)) {
                    return {key: "const", op: 1};
                } else {
                    // Otherwise, need to get default value for possibility of nothing.
                    return {
                        ...q,
                        key: "pure",
                        op: "orElse",
                        // If argument exists, then return 1, otherwise return 0.
                        arg: [{
                            ...q,
                            key: "pure",
                            op: "and",
                            arg: [avoidEvaluation(q.arg[0]), {
                                key: "const",
                                op: 1,
                            }]
                        }, {
                            ...q,
                            key: "const",
                            op: 0,
                            arg: undefined
                        }]
                    };
                }
            }
        }
        // TODO: X & Y observation. Can reduce stateful(X & Y) to X & stateful(Y) in certain circumstances.
        return q;
    } else if(q.key == "group") {
        return q;
    } else if (q.key === "update") {
        return q;
    } else if(q.key == "prefix") {
        return q;
    } else if(q.key == "placeholder") {
        return q;
    }
    return q;
}
optimizer.deadCodeElimination = deadCodeElimination;

/*
 sum(*B & sum(data.*A.value + data.*B.value))

 sum(data.*A.value / sum(data.*B.value))
*/

// andThen is the only conjunction for nothings.
// This has the property of being able to be hoisted in best case.
// As such, attempt to hoist andThen expressions whenever the free variables of the exp are not bound.
let hoistAndThen = (q) => {
    
}

let reduceCount = (q) => {
    if (q.arg)
        q.arg = q.arg.map(reduceCount);
    if(q.key == "stateful" && q.op == "count") {
        q.arg[0] = avoidEvaluation(q.arg[0]);
    }
    return q;
}

optimizer.shrinking = (q) => {
    let oldSize = getSize(q);
    let newSize = oldSize;
    do {
        oldSize = newSize;
        q = deadCodeElimination(q);
        q = constantFold(q);
        newSize = getSize(q);
    } while(newSize < oldSize);
    return q;
};

optimizer.extremeHoisting = (q) => {
    // sum(A / B) -> sum(A) / B
    // convert_i64(sum(convert_i64(q))) -> convert_i64(convert_i64(sum(q))) -> convert_i64(sum(q))
}

let loopsIdentify = (q, filters, vars) => {
    if(!q.fre)
        return;
    let freeVars = q.fre;
    for (let i = 0; i < freeVars.length; i++) {
        let varName = freeVars[i];
        freeVars = sets.unique(sets.union(freeVars, vars[varName].vars));
    }
    let trueBndVars = sets.diff(q.vars, freeVars);
    for (let varName of freeVars) {
        let otherVars = sets.diff(sets.union(trueBndVars, freeVars), [varName]);
        if (filters[varName]) {
            filters[varName].orthogVars = sets.union(filters[varName].orthogVars, otherVars);
            for(let orthogVar of otherVars) {
                if(!filters[orthogVar])
                    filters[orthogVar] = {orthogVars: []};
                filters[orthogVar].orthogVars = sets.union(filters[orthogVar].orthogVars, [varName]);
            }
        } else {
            filters[varName] = {};
            filters[varName].orthogVars = otherVars;
            for(let orthogVar of otherVars) {
                if(!filters[orthogVar])
                    filters[orthogVar] = {orthogVars: []};
                filters[orthogVar].orthogVars = sets.union(filters[orthogVar].orthogVars, [varName]);
            }
        }
    }
    if (q.arg)
        q.arg.map(arg => loopsIdentify(arg, filters, vars));
    if (q.key == "var") {
        filters[q.op].type = q.schema.type;
    }
}

let setUnion = (name, name2, setObj, filters) => {
    let val1 = setFind(name, setObj);
    let val2 = setFind(name2, setObj);
    if (val1 != val2) {
        filters[val1].orthogVars = sets.unique(sets.union(filters[val1].orthogVars, filters[val2].orthogVars));
        filters[val2].orthogVars = filters[val1].orthogVars;
        setObj[val1] = val2;
    }
}

let setFind = (name, setObj) => {
    while (setObj[name] !== undefined) {
        name = setObj[name];
    }
    return name;
}

let loopsConsolidate = (q, setObj) => {
    if(!q.fre || !q.ext)
        return;
    if (q.arg)
        q.arg.map(elem => loopsConsolidate(elem, setObj));
    q.vars = sets.unique(q.vars.map((elem) => setFind(elem, setObj)));
    q.fre = sets.unique(q.fre.map((elem) => setFind(elem, setObj)));
    q.bnd = sets.unique(q.bnd.map((elem) => setFind(elem, setObj)));
    q.mind = sets.unique(q.mind.map((elem) => setFind(elem, setObj)));
    q.dims = sets.unique(q.dims.map((elem) => setFind(elem, setObj)));
    q.ext = sets.unique(q.ext.map((elem) => setFind(elem, setObj)));
    if (q.key == "var") {
        q.op = setFind(q.op, setObj);
    }
}


optimizer.loopsConsolidate = (q, vars, sameDomains) => {
    let filters = {};
    let setObj = {};
    loopsIdentify(q, filters, vars);

    for (let varName of Object.keys(vars)) {
        if (setObj[varName] !== undefined) {
            delete vars[varName];
            continue;
        }
        vars[varName].vars = sets.unique(vars[varName].vars.map(varName => setFind(varName, setObj)));
        vars[varName].vars1 = sets.unique(vars[varName].vars1.map(varName => setFind(varName, setObj)));
        filters[varName].orthogVars = sets.union(filters[varName].orthogVars, vars[varName].vars);
        for(let depName of vars[varName].vars) {
            filters[depName].orthogVars = sets.union(filters[depName].orthogVars, [varName]);
        }
    }

    for (let varName of Object.keys(filters)) {
        let filterObj = filters[varName];
        let queue = filterObj.orthogVars.map((elem) => setFind(elem, setObj));
        let alreadyFound = [];
        while (queue.length > 0) {
            let varName = queue.pop();
            alreadyFound.push(varName);
            let extraVars = vars[varName].vars.map((elem) => setFind(elem, setObj));
            filterObj.orthogVars = [...filterObj.orthogVars, ...extraVars];
            queue = sets.diff([...queue, ...extraVars], alreadyFound);
        }
    }

    for (let varName of Object.keys(filters)) {
        let set = setFind(varName, setObj);
        let filterObj = filters[set];
        let orthogVars = filterObj.orthogVars.map((elem) => setFind(elem, setObj));

        let potentialConsolidations;
        do {
            potentialConsolidations = Object.keys(filters).filter((filterName) => {
                let filterSet = setFind(filterName, setObj);
                if (set == filterSet)
                    return false;
                if (orthogVars.includes(filterSet))
                    return false;
                if (filters[filterName].orthogVars.includes(set))
                    return false;
                let obj = filters[filterName];
                if (typing.isUnknown(obj.type))
                    return false;
                return sameDomains[varName].includes(filterName);
            });
            if(potentialConsolidations.length == 0)
                break;
            let filterName = potentialConsolidations[0];
            setUnion(set, filterName, setObj, filters);
            set = setFind(varName, setObj);
        } while(potentialConsolidations.length > 0);
    }
    loopsConsolidate(q, setObj);

    return q;
};

/*
 TODO: 
 - Eta Reduction
 - Constant Folding
 - Non-intersection of object key and get key
 - Combine *A and *B if not interfering.
 Thoughts:
 - Once dependencies are determined, "and" can be removed, no?
    - a & b = b - Given a doesn't have the nothing property.
    - *A || b = *A - Given *A doesn't have the nothing property.
    - sum (a + b) & b = b
    - (a + b) & c -> (a & b) & c

X = X -> true
X < X -> false
A & A -> A
A & (A & B) -> A & B
A || A -> A
A || (A || B) -> A || B

agg(A & B) -> A & agg(B) if all of A's free vars aren't bound by agg.

*/