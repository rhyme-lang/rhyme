
let typing = {}
let types = {}
let typeSyms = {}
exports.typing = typing;
exports.types = types;
exports.typeSyms = typeSyms;


let createType = (str) => ({__rh_type: str});

types["any"] = createType("any"); // Can be anything. In C, must use tag to determine allow.
types["nothing"] = createType("nothing"); // nothing is a set with 1 value in it: nothing
let nothingSet = new Set([types.nothing]);

types["boolean"] = createType("boolean");
types["string"] = createType("string"); // All string literal types are a subset of this type.

types["u8"] = createType("u8");
types["u16"] = createType("u16");
types["u32"] = createType("u32");
types["u64"] = createType("u64");
// u8 <: u16 <: u32 <: u64 (subtypes)

types["i8"] = createType("i8");
types["i16"] = createType("i16");
types["i32"] = createType("i32");
types["i64"] = createType("i64");
// i8 <: i16 <: i32 <: i64

types["f32"] = createType("f32");
types["f64"] = createType("f64");
// f32 <: f64
types["emptyObject"] = [];

let numberTypes = [
    types.u8, types.u16, types.u32, types.u64,
    types.i8, types.i16, types.i32, types.i64,
    types.f32, types.f64,
];

// u8 <: i16, u16 <: i32, u32 <: i64
// Implicitly or explicitly convert signed to unsigned, and unsigned to same-size signed when needed?
// And also consider conversion between floats and integers.

typeSyms["union"] = "union"; // arg1 U arg2 U arg3 ...
typeSyms["dynkey"] = "dynkey"; // wrapped arg is subtype of arg
typeSyms["function"] = "function"; // (p1, p2, ...) -> r1
typeSyms["tagged_type"] = "tagged_type"; // object with a specialized interface to it used by codegen.

let extractUnion = (type) => {
    if(type.__rh_type === typeSyms.union)
        return Array.from(type.__rh_type_union_set);
    return [type];
}

typing.createUnion = (...arr) => {
    if(arr.includes(types.any))
        return types.any;
    if(arr.length === 1)
        return arr[0];
    let union_arr = arr.reduce((accumulator, curr) => {
        if(curr.__rh_type && curr.__rh_type === typeSyms.union)
            accumulator.push(...curr.__rh_type_union_set);
        else
            accumulator.push(curr);
        return accumulator;
    }, []);
    let set = new Set(union_arr);
    for(let type1 of set.keys()) {
        for(let type2 of set.keys()) {
            if(type1 === type2)
                continue;
            /*
            * If A <: B then A | B = B
            * Example: u8 | u16 = u16.
            */
            if(typing.isSubtype(type1, type2)) {
                set.delete(type1);
                break;
            }
        }
    }
    if(set.size === 1) {
        return Array.from(set)[0];
    }
    return {
        __rh_type: typeSyms.union,
        __rh_type_union_set: set
    }
}

let createUnionWithSet = (set) => {
    if(set.has(types.any))
        return types.any;
    for(let type1 of set.keys()) {
        for(let type2 of set.keys()) {
            if(type1 === type2)
                continue;
            if(typing.isSubtype(type1, type2)) {
                set.delete(type1);
                break;
            }
        }
    }
    if(set.size === 1) {
        return Array.from(set)[0];
    }
    return {
        __rh_type: typeSyms.union,
        __rh_type_union_set: set
    }
}

typing.createMaybe = (type) => {
    return typing.createUnion(type, types.nothing);
}

typing.createFunction = (result, ...params) => {
    return {
        __rh_type: typeSyms.function,
        __rh_type_result: result,
        __rh_type_params: params
    }
}

typing.createKey = (supertype, symbolName="Key") => {
    if(typeof supertype === "string")
        return supertype;
    return {
        __rh_type: typeSyms.dynkey,
        __rh_type_symbol: freshSym(symbolName),
        __rh_type_supertype: supertype
    }
}

typing.removeTag = (type) => {
    if(type.__rh_type != typeSyms.tagged_type)
        return type;
    return typing.removeTag(type.__rh_type_innertype);
}

typing.createTaggedType = (tag, data, innerType) => {
    return {
        __rh_type: typeSyms.tagged_type,
        __rh_type_tag: tag,
        __rh_type_data: data,
        __rh_type_innertype: innerType
    };
}

typing.objBuilder = () => {
    let list = [];
    let builderObj = {
        add: (key, value) => {
            list.push([key, value]);
            return builderObj;
        },
        build: () => list
    };
    return builderObj;
}

typing.createSimpleObject = (obj) => {
    let list = [];
    for(let key of Object.keys(obj)) {
        list.push([key, obj[key]]);
    }
    return list;
}

typing.createVec = (vecType, keyType, dim, dataType) => {
    if(dim == 1)
        return typing.createTaggedType(vecType, {dim: dim},
            typing.objBuilder().add(typing.createKey(keyType), dataType).build()
        );
    return typing.createTaggedType(vecType, {dim: dim},
        typing.objBuilder().add(typing.createKey(keyType), typing.createVec(vecType, keyType, dim - 1, dataType)).build()
    );
}

let performObjectGet = (objectType, keyType) => {
    if(objectType === types.any)
        return types.any;
    let objectTypeList = extractUnion(objectType);
    let keyTypeList = extractUnion(keyType);

    let possibleResults = new Set([]);
    // NU = Not Unioned.
    for(let objectTypeNU of objectTypeList) {
        if(objectTypeNU === types.nothing) {
            possibleResults.add(types.nothing);
            continue;
        }
        objectTypeNU = typing.removeTag(objectTypeNU);
        if(!Array.isArray(objectTypeNU)) {
            throw new Error("Unable to perform object get on non-object type: " + prettyPrintType(objectTypeNU))
        }
        for(let keyTypeNU of keyTypeList) {
            let nothing = true;
            for(let keyValue of objectTypeNU) {
                if(typing.isSubtype(keyValue[0], keyTypeNU)) {
                    possibleResults.add(keyValue[1]);
                    nothing = false;
                    break;
                }
                if(typeCanOverlap(keyValue[0], keyTypeNU))
                    possibleResults.add(keyValue[1]);
            }
            if(nothing)
                possibleResults.add(types.nothing);
        }
    }
    return createUnionWithSet(possibleResults);
}

const SUBTYPE_ORDERS = [
    [types.u8, types.u16, types.u32, types.u64],
    [types.i8, types.i16, types.i32, types.i64],
    [types.u8, types.i16, types.i32, types.i64],
    [types.u16, types.i32, types.i64],
    [types.u32, types.i64],
];

let typeConforms_NonUnion = (type, expectedType) => {
    if(type === expectedType)
        return true;
    if(typeof type === "string" && expectedType === types.string)
        return true;
    if(type.__rh_type === typeSyms.tagged_type)
        type = type.__rh_type_innertype;
    if(expectedType.__rh_type === typeSyms.tagged_type)
        expectedType = expectedType.__rh_type_innertype;

    if(expectedType.__rh_type === typeSyms.dynkey) {
        // If expected type is a dynamic key, there is no guarantee of what it could be. It could be empty. As such, it has no guaranteed subtypes.
        // It could only be a subtype of itself, but we already know s1Type != s2Type.
        return false;
    }
    if(type.__rh_type === typeSyms.dynkey) {
        // If supertype of dynkey is subtype of s2, then dynkey is subtype of s2.
        if(typing.typeConforms(type.__rh_type_supertype, expectedType))
            return true;
    }
    if(type.__rh_type === typeSyms.function) {
        if(expectedType.__rh_type !== typeSyms.function)
            return false    
        // For function subtyping rules:
        //  S_1 <: T_1 yields T_1 -> any <: S_1 -> any
        //  S_2 <: T_2 yields any -> S_2 <: any -> T_2
        // So given the two, T_1 -> S_2 <: S_1 -> T_2
        if(type.__rh_type_params.length !== expectedType.__rh_type_params.length)
            return false;
        let resConforms = typing.typeConforms(type.__rh_type_result, expectedType.__rh_type_result);
        if(!resConforms)
            return false;
        let argsConform = type.__rh_type_params.reduce((acc, _, i) => acc &&
            typing.typeConforms(expectedType.__rh_type_params[i], type.__rh_type_params[i])
        );
        if(!argsConform)
            return false;
        return true;
    }
    if(Array.isArray(type) && Array.isArray(expectedType)) {
        let invalid = false;
        for(let keyValue of expectedType) {
            // If each potential access doesn't guarantee to have a subtype of the supertype's value for that field
            // then it could return a value that isn't in the supertype's type. So it doesn't conform.
            if(!typing.isSubtype(performObjectGet(type, keyValue[0]), keyValue[1])) {
                invalid = true;
                break;
            }
        }
        if(!invalid) 
            return true;
    }
    for(let subtype_order_arr of SUBTYPE_ORDERS) {
        let i1 = subtype_order_arr.indexOf(type);
        if(i1 === -1)
            continue;
        let i2 = subtype_order_arr.indexOf(expectedType);
        if(i2 === -1)
            continue;
        if(i1 < i2)
            return true;
    }
    return false;
}

// typeConforms is same as isSubtype.
typing.typeConforms = (type, expectedType) => {
    if(expectedType === types.any)
        return true;

    let s1 = extractUnion(type);
    let s2 = extractUnion(expectedType);

    for(let s1Type of s1) {
        let valid = false;
        for(let s2Type of s2) {
            if(typeConforms_NonUnion(s1Type, s2Type)) {
                valid = true;
                break;
            }
        }
        if(!valid)
            return false;
    }
    return true;
}
typing.isSubtype = typing.typeConforms; // Alias

let typeCanOverlap = (type, type2) => {
    if(type === type2)
        return true;
    if(type === types.any)
        return true;
    if(type2 === types.any)
        return true;
    let s1 = extractUnion(type);
    let s2 = extractUnion(type2);
    for(let s1Type of s1) {
        for(let s2Type of s2) {
            if(typing.isSubtype(s1Type, s2Type))
                return true;
            if(typing.isSubtype(s2Type, s1Type))
                return true;
            // TODO Check the rules on this.
            if(s1Type.__rh_type === typeSyms.dynkey) {
                if(typing.isSubtype(s2Type, s1Type.__rh_type_supertype))
                    return true;
            }
            if(s2Type.__rh_type === typeSyms.dynkey) {
                if(typing.isSubtype(s1Type, s2Type.__rh_type_supertype))
                    return true;
            }
        }
    }
    return false;
}

let isInteger = (type) => {
    if(type.__rh_type === typeSyms.union)
        // Validate that every value in the union is a integer. Hence overall, it is a integer.
        return extractUnion(type).reduce((acc, elem) => acc && isInteger(elem), true);
    type = typing.removeTag(type);
    if(type.__rh_type === typeSyms.dynkey)
        // Dynkeys are subtypes of the supertype. Hence, if supertype is integer, dynkey is integer.
        return isInteger(type.__rh_type_supertype);
    if( type === types.u8 || 
        type === types.u16 || 
        type === types.u32 || 
        type === types.u64 || 
        type === types.i8 || 
        type === types.i16 || 
        type === types.i32 || 
        type === types.i64)
        return true;
    return false;
}
typing.isInteger = isInteger;

let withoutNothing = (type) => {
    if(type.__rh_type !== typeSyms.union)
        return type;
    return createUnionWithSet(type.__rh_type_union_set.difference(nothingSet));
}

let isNothingOr = (func, type) => {
    if(type === types.nothing)
        return true;
    return func(withoutNothing(type));
}

// Same as integer except for strings. Includes string literals.
let isString = (type) => {
    if(type.__rh_type === typeSyms.union)
        return extractUnion(type).reduce((acc, elem) => acc && isString(elem), true);
    type = typing.removeTag(type);
    if(type.__rh_type === typeSyms.dynkey)
        return isString(type.__rh_type_supertype);
    if(type === types.string)
        return true;
    if(typeof type === "string")
        return true;
    return false;
}

typing.isString = isString

let prettyPrintType = (schema) => {
    if(schema === undefined)
        return "~Undefined~";
    if(schema === null)
        return "~Null~";
    if(Object.values(types).includes(schema))
        return Object.keys(types).filter((key) => types[key] === schema)[0];
    if(typeof schema === "string")
        return "\"" + schema + "\"";
    if(schema.__rh_type === typeSyms.union)
        return "(" + Array.from(schema.__rh_type_union_set).map(type => prettyPrintType(type)).join(" | ") + ")";
    if(schema.__rh_type === typeSyms.function)
        return "(" + schema.__rh_type_params.map(type => prettyPrintType(type)).join(", ") + ") -> " + prettyPrintType(schema.__rh_type_result);
    if(schema.__rh_type === typeSyms.dynkey)
        return "<"+prettyPrintType(schema.__rh_type_supertype)+">";
    if(schema.__rh_type === typeSyms.tagged_type)
        return schema.__rh_type_tag +":"+prettyPrintType(schema.__rh_type_innertype);
    if(Array.isArray(schema))
        return `{${schema.map((keyValue) => `${prettyPrintType(keyValue[0])}: ${prettyPrintType(keyValue[1])}`).join(", ")}}`;
    if(typeof schema === "object")
        return "~UNK:" + JSON.stringify(schema) + "~";
    return "~Invalid~";
}
typing.prettyPrintType = prettyPrintType;

let indent = (str) => str.split("\n").join("\n  ");

let prettyPrint = (q) => {
    if(q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return "inp";
    } else if(q.key === "const") {
        if(typeof q.op === "object")
            return "{}";
        return String(q.op);
    } else if(q.key === "var") {
        return q.op;
        // TODO
    } else if(q.key === "get") {
        let [e1, e2] = q.arg.map(prettyPrint);
        return `${e1}[${e2}]`;
    } else if(q.key === "pure") {
        let es = q.arg.map(prettyPrint)
        return q.op + "(" + es.join(", ") + ")"
    } else if(q.key === "hint") {
        return types.nothing;
    } else if(q.key === "mkset") {
        let [e1] = q.arg.map(prettyPrint);
        return `mkset(${e1})`;
    } else if(q.key === "prefix") {
        let [e1] = q.arg.map(prettyPrint)
        return "prefix_"+q.op+"("+e1+")"
    } else if(q.key === "stateful") {
        let [e1] = q.arg.map(prettyPrint)
        return q.op+"("+e1+")"
    } else if(q.key === "group") {
        let [e1, e2] = q.arg.map(prettyPrint)
        return "{ "+ e1 + ": " + e2 + " }"
    } else if(q.key === "update") {
        let [e0,e1,e2,e3] = q.arg.map(prettyPrint)
        if (e3) return `${e0} {\n    ${e1}: ${indent(e2)}\n  } / ${e3} `
        return `(${e0} {\n    ${e1}: ${indent(e2)}\n})`
    }
    throw new Error("Unable to determine type of query: " + q.key + " " + JSON.stringify(q));
}

let symIndex = 0;
let freshSym = (pref) => pref + (symIndex++);

let validateIRQuery = (schema, cseMap, boundKeys, q) => {
    // if(q.schema) {
    //     return q.schema;
    // }
    let res = _validateIRQuery(schema, cseMap, boundKeys, q);
    q.schema = res;
    //console.log(prettyPrint(q) + " : " + prettyPrintType(res));
    return res;
};

let _validateIRQuery = (schema, cseMap, boundKeys, q) => {
    if(q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return schema;
    } else if(q.key === "loadInput") {
        let [e1] = q.arg;
        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        if (!isString(t1)) {
            throw new Error("Filename in loadInput expected to be a string but got " + prettyPrintType(t1))
        }
        return q.schema;
    } else if(q.key === "const") {
        if(typeof q.op === "object" && Object.keys(q.op).length === 0)
            return [];
        if(typeof q.op === "number") {
            if(q.op < 0) {
                if(q.op >= -127)
                    return types.i8;
                if(q.op >= -32767)
                    return types.i16;
                if(q.op >= -2147483647)
                    return types.i32;
                return types.i64;
            }
            if(q.op < 256)
                return types.u8;
            if(q.op <= 65535)
                return types.u16;
            if(q.op <= 4294967295)
                return types.u32;
            return types.u64;
        }
        if(typeof q.op === "string")
            return q.op;
        throw new Error("Unknown const: " + q.op)
    } else if(q.key === "var") {
        if(boundKeys[q.op] === undefined) {
            throw new Error("Unable to determine type of variable, given no context.");
            //console.log("Unable to find var: " + q.op + ", creating a new one.");
            //boundKeys[q.op] = freshSym("var");
        }
        return boundKeys[q.op];
    } else if(q.key === "get") {

        let [e1, e2] = q.arg;
        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        if(!typing.isSubtype(t1, typing.createMaybe(types.emptyObject))) {
            throw new Error("Unable to perform get operation on non-object: " + prettyPrintType(t1));
        }
        
        if(e2.key == "var") {
            if(!boundKeys[e2.op]) {
                let keys = [];
                extractUnion(t1).forEach((ty) => {
                    if(ty === types.nothing)
                        return;
                    // Extract all keys from object.
                    ty = typing.removeTag(ty);
                    keys.push(...ty.map((entry) => entry[0]));
                });
                boundKeys[e2.op] = typing.createUnion(...keys);
            }
        }

        let t2 = validateIRQuery(schema, cseMap, boundKeys, e2);
        
        return performObjectGet(t1, t2);
    } else if(q.key === "pure") {
        let [e1, e2] = q.arg;

        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        // If q is a binary operation:
        if(q.op === "plus" || q.op === "equal" || q.op === "and" || q.op === "notEqual" ||
           q.op === "minus" || q.op === "times" || q.op === "fdiv" || q.op === "div" || q.op === "mod") {
            let t2 = validateIRQuery(schema, cseMap, boundKeys, e2);
            if(q.op == "plus") {
                // If q is a plus, find lowest subtype of both values and
                if(isNothingOr(isInteger, t1) && isNothingOr(isInteger, t2)) {
                    let possibleResults = new Set([]);
                    if(!isInteger(t1) || !isInteger(t2)) {
                        possibleResults.add(types.nothing);
                    }
                    for(let numberType of numberTypes) {
                        if(typing.isSubtype(t1, numberType) && typing.isSubtype(t2, numberType)) {
                            possibleResults.add(numberType);
                            break;
                        }
                    }
                    return createUnionWithSet(possibleResults);
                } else {
                    throw new Error("Unimplemented ability to type-check addition of non-integer values.")
                }
            } else if (q.op == "fdiv") {
                // TODO: validate types for fdiv
                return types.u32
            } else if (q.op == "equal") {
                // TODO: validate types for equal
                return types.boolean
            } else if (q.op == "notEqual") {
                // TODO: validate types for notEqual
                return types.boolean
            } else if (q.op == "and") {
                // TODO: validate types for and
                return t2
            }
            throw new Error("Pure operation not implemented: " + q.op);
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if(q.key === "hint") {

        return types.nothing;
    } else if(q.key === "mkset") {

        let [e1] = q.arg;
        let keyType = validateIRQuery(schema, cseMap, boundKeys, e1);
        if(keyType.__rh_type !== typeSyms.dynkey)
            return [[typing.createKey(keyType, "Mkset"), types.boolean]];
        return [[keyType, types.boolean]];

    } else if(q.key === "prefix") {

    } else if(q.key === "stateful") {

        let argType = validateIRQuery(schema, cseMap, boundKeys, q.arg[0])

        if(q.op === "sum" || q.op === "product") {
            // Check if each arg extends (number | nothing)
            if(argType === types.nothing)
                throw new Error("Unable to " + q.op + " on a query that is always nothing: " + prettyPrint(q));
            if(!isInteger(argType))
                throw new Error("Unable to union non-integer values currently. Got: " + prettyPrintType(argType));
            let possibleResults = new Set([]);
            for(let argExtract of extractUnion(argType)) {
                if(argExtract === types.nothing)
                    continue;
                if(argExtract.__rh_type === typeSyms.dynkey)
                    possibleResults.add(argExtract.__rh_type_supertype);
                else
                    possibleResults.add(argExtract);
            }
            return createUnionWithSet(possibleResults);
        } else if(q.op === "min" || q.op === "max") {
            // Check if each arg extends (number | nothing)
            if(argType === types.nothing)
                throw new Error("Unable to " + q.op + " on a query that is always nothing: " + prettyPrint(q));
            if(!isInteger(argType))
                throw new Error("Unable to union non-integer values currently.");
            return withoutNothing(argType);
        }
        if(q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return types.u32;
        }
        if(q.op === "single" || q.op === "first" || q.op === "last") {
            // It could be the generator is empty. So it could result Nothing
            // TODO: Allow hint to specify it will guaranteed be non-empty.
            // return typing.createMaybe(argType);
            return argType
        }
        if(q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.
            // TODO: See if we should default to size of array as u32 here.
            return typing.objBuilder()
                .add(
                    typing.createKey(types.u32, "Array"),
                    withoutNothing(argType))
                .build();
        }
        if (q.op === "print") {
            return types.nothing;
        }
        throw new Error("Unimplemented stateful expression " + q.op);
    } else if(q.key === "group") {
        throw new Error("Unimplemented");
        let [e1, e2] = q.arg;
        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        let t2 = validateIRQuery(schema, cseMap, boundKeys, e2);
        if(t1 !== types.string && !typing.isKeySym(t2))
            throw new Error("Unable to use non-string field as key. Found: " + prettyPrintType(t1));
        //return "{ "+ e1 + ": " + e2 + " }"
        //return {"*": t2};
    } else if(q.key === "update") {
        let [e1, e2, e3, e4] = q.arg;
        if(e4 !== undefined) {
            let _ = validateIRQuery(schema, cseMap, boundKeys, e4);
        }
        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        if(!typing.isSubtype(t1, types.emptyObject))
            throw new Error("Unable to update field of type: " + prettyPrintType(t1));
        let t3 = validateIRQuery(schema, cseMap, boundKeys, e3);
        if(e2.op === "vars") {
            let currObj = t3;
            for(let i = e2.arg.length - 1; i >= 0; i--) {
                let keyVar = e2.arg[i];
                let keyVarType = validateIRQuery(schema, cseMap, boundKeys, keyVar);
                if(!isInteger(keyVarType) && !isString(keyVarType))
                    throw new Error("Unable to use type: " + prettyPrintType(keyVarType) + " as object key");
                if(i === 0) {
                    return [[keyVarType, currObj], ...t1];
                } else {
                    currObj = [[keyVarType, currObj]];
                }
            }
        }
        let t2 = validateIRQuery(schema, cseMap, boundKeys, e2);
        if(!isInteger(t2) && !isString(t2))
            throw new Error("Unable to use type: " + prettyPrintType(t2) + " as object key");
        return [[t2, t3], ...t1];
    }
    throw new Error("Unable to determine type of query: " + prettyPrint(q));
}

typing.validateIR = (schema, q) => {
    if(schema === types.any || schema === undefined)
        return types.any;
    let boundKeys = {};
    let cseMap = {};
    let res = validateIRQuery(schema, cseMap, boundKeys, q);
    //console.log(prettyPrintType(res));
    return res;
}