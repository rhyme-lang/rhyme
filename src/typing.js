
let typing = {}
exports.typing = typing;

typing["any"] = Symbol("any");
typing["nothing"] = Symbol("nothing"); // nothing is a set with 1 value in it: nothing

typing["boolean"] = Symbol("boolean");
typing["string"] = Symbol("string"); // All string literal types are a subset of this type.
typing["number"] = Symbol("number");

typing["isKeySym"] = (type) => {
    if (type === typing.any)
        return false;
    if (type === typing.nothing)
        return false;
    if (type === typing.void)
        return false;
    if (type === typing.unknown)
        return false;
    if (type === typing.boolean)
        return false;
    if (type === typing.string)
        return false;
    if (type === typing.number)
        return false;
    return (typeof type === "symbol");
}

typing["sum"] = Symbol("sum"); // t1 u t2 u t3 ...
typing["createSum"] = (...arr) => {
    if (arr.length === 0)
        return typing.void;
    if (arr.length === 1)
        return arr[0];
    let sum_arr = arr.reduce((accumulator, curr) => {
        if (curr.__rh_type && curr.__rh_type === typing.sum)
            accumulator.push(... curr.__rh_type_params);
        else
            accumulator.push(curr);
        return accumulator;
    }, []);
    if (sum_arr.includes(typing.string))
        sum_arr = sum_arr.filter((elem) => !isSpecificString(elem));
    return {
        __rh_type: typing.sum,
        __rh_type_params: new Set(sum_arr)
    }
}
typing["extractSum"] = (type) => {
    if (type.__rh_type === typing.sum)
        return [...(type.__rh_type_params)];
    return [type];
}

typing["createMaybe"] = (type) => {
    return typing.createSum(type, typing.nothing);
}

typing["function"] = Symbol("function"); // (p1, p2, ...) -> r1
typing["createFunction"] = (result, ...params) => {
    return {
        __rh_type: typing.function,
        __rh_type_params: [result, params]
    }
}

let symIndex = 0;
let freshSym = (pref) => Symbol(pref + (symIndex++));

typing["typeConforms"] = (type, expectedType) => {
    if (expectedType === typing.any)
        return true;
    if (type === typing.any)
        return true;
    let s1;
    if (type.__rh_type === typing.sum)
        s1 = new Set(type.__rh_type_params)
    else
        s1 = new Set([type])
    let s2;
    if (expectedType.__rh_type === typing.sum)
        s2 = new Set(expectedType.__rh_type_params)
    else
        s2 = new Set([expectedType])
    for (let s1Type of s1.keys()) {
        let valid = false;
        for (let s2Type of s2.keys()) {
            if (s1Type === s2Type) {
                valid = true;
                break;
            }
            if (s1Type.__rh_type || s2Type.__rh_type) {
                if (s1Type.__rh_type != s2Type.__rh_type)
                    continue;
                if (s1Type.__rh_type === typing.function) {
                    if (s1Type === s2Type) {
                        valid = true;
                        break;
                    }
                }
            }
            if (typeof s1Type === "string" && s2Type === typing.string) {
                valid = true;
                break;
            }
        }
        if (!valid)
            return false;
    }
    return true;
}

let typeOverlaps = (type, type2) => {
    if (type === type2)
        return true;
    if (type === typing.any)
        return true;
    if (type2 === typing.any)
        return true;
    let s1;
    if (type.__rh_type === typing.sum)
        s1 = new Set(type.__rh_type_params)
    else
        s1 = new Set([type])
    let s2;
    if (type2.__rh_type === typing.sum)
        s2 = new Set(type2.__rh_type_params)
    else
        s2 = new Set([type2])
    for (let s1Type of s1.keys()) {
        for (let s2Type of s2.keys()) {
            if (s1Type === s2Type) {
                return true;
            }
            if (typeof s1Type === "string" && s2Type === typing.string) {
                return true;
            }
            if (typeof s2Type === "string" && s1Type === typing.string) {
                return true;
            }
            if (typing.isKeySym(s1Type) && (typing.isKeySym(s2Type) || s2Type == typing.string || typeof s2Type === "string"))
                return true;
            if (typing.isKeySym(s2Type) && (typing.isKeySym(s1Type) || s1Type == typing.string || typeof s1Type === "string"))
                return true;
        }
    }
    return false;
}

// Is any sort of string.
let isString = (type) => {
    if (type === typing.string)
        return true;
    if (typeof type === "string")
        return true;
    if (isKeySym(type))
        return true;
    if (type.__rh_type === typing.sum)
        return Array.from(type.__rh_type_params).reduce((acc, curr) => acc && (isString(curr)), true);
    return false;
}

// Is finite-sized string sum
let isSpecificString = (type) => {
    if (type === typing.string)
        return false;
    if (typeof type === "string")
        return true;
    if (typing.isKeySym(type))
        return true;
    if (type.__rh_type === typing.sum)
        return Array.from(type.__rh_type_params).reduce((acc, curr) => acc && (isString(curr)), true);
    return false;
}

let objKeyList = (obj) => {
    if (obj === undefined)
        throw new Error("Undefined object");
    return [...Object.getOwnPropertySymbols(obj), ...Object.keys(obj)];
}
/*
let prettyPrintList = [];
let prettyPrintType = (schema) => {
    if (prettyPrintList.includes(schema))
        return "~Recursive~";
    prettyPrintList.push(schema);
    let res = _prettyPrintType(schema);
    prettyPrintList.pop(schema);
    return res;
}*/
let prettyPrintType = (schema) => {
    if (schema === undefined)
        return "~Error~";
    if (schema === typing.any)
        return "Any";
    if (schema === typing.nothing)
        return "Nothing";
    if (schema === typing.void)
        return "Void";
    if (schema === typing.number)
        return "Number";
    if (schema === typing.boolean)
        return "Boolean";
    if (schema === typing.string)
        return "String";
    if (typeof schema === "symbol")
        return String(schema)
    if (typeof schema === "string")
        return "\"" + schema + "\"";
    if (schema.__rh_type === typing.sum)
        return "(" + Array.from(schema.__rh_type_params).map(type => prettyPrintType(type)).join(" | ") + ")";
    if (schema.__rh_type === typing.function)
        return "(" + schema.__rh_type_params[1].map(type => prettyPrintType(type)).join(", ") + ") -> " + prettyPrintType(schema.__rh_type_params[0]);
    return `{${objKeyList(schema).map((key) => `${typing.isKeySym(key) ? String(key) : key}: ${prettyPrintType(schema[key])}`).join(", ")}}`;
}

typing.prettyPrintType = prettyPrintType

typing["validateIRQuery"] = (schema, cseMap, boundKeys, q) => {
    //if (cseMap[JSON.stringify(q)])
    //    return cseMap[JSON.stringify(q)];
    let res = typing["_validateIRQuery"](schema, cseMap, boundKeys, q);
    q.schema = res;
    //cseMap[JSON.stringify(q)] = res;
    return res;
};

let indent = (str) => str.split("\n").join("\n  ");

/*
let prettyPrint = (q) => {
    if (prettyPrintList.includes(q))
        return "~Recursive~";
    prettyPrintList.push(q);
    let res = _prettyPrint(q);
    prettyPrintList.pop(q);
    return res;
}*/
let prettyPrint = (q) => {
    if (q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return "inp";
    } else if (q.key === "const") {
        if (typeof q.op === "object")
            return "{}";
        return String(q.op);
    } else if (q.key === "var") {
        return q.op;
        // TODO
    } else if (q.key === "get") {
        let [e1, e2] = q.arg.map(prettyPrint);
        return `${e1}[${e2}]`;
    } else if (q.key === "pure") {
        let es = q.arg.map(prettyPrint)
        return q.op + "(" + es.join(", ") + ")"
    } else if (q.key === "hint") {
        return typing.nothing;
    } else if (q.key === "mkset") {
        let [e1] = q.arg.map(prettyPrint);
        return `mkset(${e1})`;
    } else if (q.key === "prefix") {
        let [e1] = q.arg.map(prettyPrint)
        return "prefix_"+q.op+"("+e1+")"
    } else if (q.key === "stateful") {
        let [e1] = q.arg.map(prettyPrint)
        return q.op+"("+e1+")"
    } else if (q.key === "group") {
        let [e1, e2] = q.arg.map(prettyPrint)
        return "{ "+ e1 + ": " + e2 + " }"
    } else if (q.key === "update") {
        let [e0,e1,e2,e3] = q.arg.map(prettyPrint)
        if (e3) return `${e0} {\n    ${e1}: ${indent(e2)}\n  } / ${e3} `
        return `(${e0} {\n    ${e1}: ${indent(e2)}\n})`
    }
    throw new Error("Unable to determine type of query: " + q.key + " " + JSON.stringify(q));
}

typing["_validateIRQuery"] = (schema, cseMap, boundKeys, q) => {
    if (q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        if (q.op === "csv") {
            return q.schema;
        }
        return schema;
    } else if (q.key === "const") {
        if (typeof q.op === "object" && objKeyList(q.op).length == 0)
            return {};
        if (typeof q.op === "number")
            return typing.number;
        if (typeof q.op === "string")
            return q.op;
        throw new Error("Unknown const: " + q.op)
    } else if (q.key === "var") {
        if (boundKeys[q.op] === undefined) {
            //console.log("Unable to find var: " + q.op + ", creating a new one.");
            boundKeys[q.op] = freshSym("var");
        }
        return boundKeys[q.op];
    } else if (q.key === "get") {
        let [e1, e2] = q.arg;
        let t1Raw = typing.validateIRQuery(schema, cseMap, boundKeys, e1);
        let posT1 = typing.extractSum(t1Raw);
        if (e2.key == "var") {
            if (!boundKeys[e2.op]) {
                let keys = [];
                posT1.forEach((elem) => keys.push(...objKeyList(elem)));
                boundKeys[e2.op] = typing.createSum(...keys);
            }
        }
        let t2Raw = typing.validateIRQuery(schema, cseMap, boundKeys, e2);
        let posT2 = typing.extractSum(t2Raw);
        let arr = [];
        for (let t1 of posT1) {
            if (t1 === typing.any) {
                arr.push(typing.any);
                continue;
            }
            if (typeof t1 !== "object") {
                if (t1 !== typing.nothing) {
                    throw new Error("Error in attempting to access field on type: " + prettyPrintType(t1));
                }
                arr.push(typing.nothing);
                continue;
            }
            for (let t2 of posT2) {
                let nothing = true;
                for (let key of objKeyList(t1)) {
                    if (key === t2) {
                        arr.push(t1[key]);
                        nothing = false;
                        break;
                    }
                    if (typeOverlaps(key, t2))
                        arr.push(t1[key]);
                }
                if (nothing)
                    arr.push(typing.nothing);
            }
        }
        return typing.createSum(...arr);
    } else if (q.key === "pure") {
        let [e1, e2] = q.arg;

        let t1 = typing.validateIRQuery(schema, cseMap, boundKeys, e1);
        if (q.op === "plus") {
            let t2 = typing.validateIRQuery(schema, cseMap, boundKeys, e2);
            if (q.op == "plus") {
                if (typing.typeConforms(t1, typing.number) && typing.typeConforms(t2, typing.number))
                    return typing.number;
                if (!typing.typeConforms(t1, typing.createMaybe(typing.number)))
                    throw new Error("Unable to conform arg type of " + prettyPrintType(t1) + " to (Number | Nothing)");
                if (!typing.typeConforms(t2, typing.createMaybe(typing.number)))
                    throw new Error("Unable to conform arg type of " + prettyPrintType(t2) + " to (Number | Nothing)");
                return typing.createMaybe(typing.number);
            }
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key === "hint") {

        return typing.nothing;
    } else if (q.key === "mkset") {

        let [e1] = q.arg;
        if (e1.key === "const") {
            return {[e1.op]: true};
        }
        return {[freshSym("mkset")]: true}
    } else if (q.key === "prefix") {

    } else if (q.key === "stateful") {

        let argType = typing.validateIRQuery(schema, cseMap, boundKeys, q.arg[0])

        if (q.op === "sum" || q.op === "product" || q.op === "min" || q.op === "max") {
            // Check if each arg extends (number | nothing)
            if (!typing.typeConforms(argType, typing.createMaybe(typing.number))) {
                throw new Error("Unable to conform arg type of " + prettyPrintType(argType) + " to (Number | Nothing)");
            }
            return typing.number;
        }
        if (q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return typing.number;
        }
        if (q.op === "single" || q.op === "first" || q.op === "last") {
            // It could be the generator is empty. So it could result Nothing
            // TODO: Allow hint to specify it will guaranteed be non-empty.
            return typing.createMaybe(argType);
        }
        if (q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.
            if (argType.__rh_type === typing.sum) {
                if (argType.__rh_type_params.has(typing.nothing))
                    argType = typing.createSum(...argType.__rh_type_params.difference(new Set([typing.nothing])));
            }
            return {[freshSym("array")]: argType};
        }
        throw new Error("Unimplemented stateful expression " + q.op);
    } else if (q.key === "group") {
        let [e1, e2] = q.arg;
        let t1 = typing.validateIRQuery(schema, cseMap, boundKeys, e1);
        let t2 = typing.validateIRQuery(schema, cseMap, boundKeys, e2);
        if (t1 !== typing.string && !typing.isKeySym(t2))
            throw new Error("Unable to use non-string field as key. Found: " + prettyPrintType(t1));
        //return "{ "+ e1 + ": " + e2 + " }"
        throw new Error("Unimplemented");
        //return {"*": t2};
    } else if (q.key === "update") {
        let [e1, e2, e3, e4] = q.arg;
        if (e4 !== undefined) {
            let _ = typing.validateIRQuery(schema, cseMap, boundKeys, e4);
        }
        let t1 = typing.validateIRQuery(schema, cseMap, boundKeys, e1);
        if (typeof t1 !== "object")
            throw new Error("Unable to update field of type: " + prettyPrintType(t1));
        let t3 = typing.validateIRQuery(schema, cseMap, boundKeys, e3);
        if (e2.op === "vars") {
            let currObj = t3;
            for (let i = e2.arg.length - 1; i >= 0; i--) {
                let variable = e2.arg[i];
                let variableType = typing.validateIRQuery(schema, cseMap, boundKeys, variable);
                if (typeof variableType !== "string" && !typing.isKeySym(variableType))
                    throw new Error("Unable to use non-specific-string field on updating object. Found: " + prettyPrintType(variableType));
                if (i === 0) {
                    t1[variableType] = currObj;
                } else {
                    currObj = {[variableType]: currObj};
                }
            }
        } else {
            let t2 = typing.validateIRQuery(schema, cseMap, boundKeys, e2);
            if (typeof t2 !== "string" && !typing.isKeySym(t2))
                throw new Error("Unable to use non-specific-string field on updating object. Found: " + prettyPrintType(t2));
            t1[t2] = t3;
        }
        return t1;
    }
    throw new Error("Unable to determine type of query: " + prettyPrint(q));
}

typing["validateIR"] = (schema, q) => {
    if (schema === typing.any)
        return;
    let boundKeys = {};
    let cseMap = {};
    let res = typing.validateIRQuery(schema, cseMap, boundKeys, q);
}