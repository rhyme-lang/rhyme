const { pretty } = require("./prettyprint");
const { typing, props } = require("./typing");
const { runtime } = require("./simple-runtime");

let optimizer = {}
exports.optimizer = optimizer;

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
        return {};
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
        if (q.op == "apply") {
            // Functions applications cannot be constant folded because functions are never constant.
            return q;
        } else if (q.op == "flatten") {
            return q; // TODO: Skipping because unknown to occur?
        } else if (q.op == "join") {
            return q; // TODO: Skipping because unknown to occur?
        } else if (q.op == "and") {
            if(q.arg[0].schema && !q.arg[0].schema.props.includes(props.nothing)) {
                return q.arg[1];
            }
            return q;
        } else if (q.op === "equal" || q.op === "notEqual" || q.op === "fdiv" || 
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
        return q;
    } else if (q.key === "hint") {
        return q;
    } else if (q.key === "mkset") {
        return q;
    } else if (q.key === "stateful") {
        if (q.op === "print")
            return q;
        if (q.op == "array")
            return q;
        /*if(q.arg[0].key == "const") {
            // If const, then it can't be "nothing".
            return {
                ...q,
                key: "const",
                op: runtime.stateful[q.op](undefined)(q.arg[0].op)
            };
        }*/
        // TODO: X & Y observation. Can reduce stateful(X & Y) to X & stateful(Y) in certain circumstances.
        return q;
        /*
        if (q.op === "sum" || q.op === "product") {
        } else if (q.op === "min" || q.op === "max") {
        } else if (q.op === "count") {
        } else if (q.op === "single" || q.op === "first" || q.op === "last") {
        } else if (q.op === "array") {
        } else */
    } else if(q.key == "group") {
        return q;
    } else if (q.key === "update") {
        return q;
    } else if(q.key == "prefix") {
        return q;
    } else if(q.key == "placeholder") {
        return q;
    }
    throw new Error("Unknown operation: " + q.key);
}
optimizer.constantFold = constantFold;

/*
 TODO: 
 - Eta Reduction
 - Constant Folding
 - Non-intersection of object key and get key
 - Combine *A and *B if not interfering.
 Thoughts:
 - Once dependencies are determined, "andThen" can be removed, no?
    - a & b = b - Given a doesn't have the nothing property.
    - *A || b = *A - Given *A doesn't have the nothing property.
    - sum (a + b) & b = b
    - (a + b) & c -> (a & b) & c
*/