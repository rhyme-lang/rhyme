const { sets } = require('./shared')

const { unique, union, intersect, diff, subset, same } = sets


let typing = {}
let types = {}
let typeSyms = {}
let props = {}
exports.typing = typing;
exports.types = types;
exports.typeSyms = typeSyms;
exports.props = props;


// ----- type definitions -----

let createType = (str) => {
    typeSyms[str] = str;
    types[str] = {typeSym: str};
};

createType("any"); // Supertype of every type. Set of all possible values
createType("never"); // Subtype of every type. Empty set.

createType("boolean");
createType("string"); // All string literal types are a subset of this type.

createType("u8");
createType("u16");
createType("u32");
createType("u64");
// u8 <: u16 <: u32 <: u64 (subtypes)

createType("i8");
createType("i16");
createType("i32");
createType("i64");
// i8 <: i16 <: i32 <: i64

createType("f32");
createType("f64");
// f32 <: f64
//types["emptyObject"] = [];

let numberTypes = [
    types.u8, types.u16, types.u32, types.u64,
    types.i8, types.i16, types.i32, types.i64,
    types.f32, types.f64,
];

props["nothing"] = "nothing";
props["error"] = "error";
let nothingSet = [props.nothing];
let errorSet = [props.error];

// u8 <: i16, u16 <: i32, u32 <: i64
// Implicitly or explicitly convert signed to unsigned, and unsigned to same-size signed when needed?
// And also consider conversion between floats and integers.

typeSyms["object"] = "object"; // {}{K: V}{K2: V2}...
typeSyms["intersect"] = "intersect"; // arg1 n arg2 n arg3 ...
typeSyms["union"] = "union"; // arg1 U arg2 U arg3 ...
typeSyms["dynkey"] = "dynkey"; // wrapped arg is subtype of arg
typeSyms["function"] = "function"; // (p1, p2, ...) -> r1
typeSyms["tagged_type"] = "tagged_type"; // object with a specialized interface to it used by codegen.
typeSyms["keyval"] = "keyval"; // Not a proper type. Used for constructing types easier.

// Type hierarchy order: (Top to bottom level)
// - Unions
// - Intersections
// - TaggedTypes
// - Base Types
// -- Then inside any base types (e.g. K_n(T) ), the hierarchy restarts for said inner types.

let typeEquals = (t1, t2) => {
    if (isSubtype(t1, t2) && isSubtype(t2, t1))
        return true;
    return false;
}
typing.typeEquals = typeEquals;

let sameType = (t1, t2) => {
    if(!t1.typeSym || !t2.typeSym) {
        if(t1 == t2)
            return true;
        return false;
    }
    if(t1.typeSym != t2.typeSym)
        return false;
    switch(t1.typeSym) {
        case "union":
            return sameType(t1.unionSet[0], t2.unionSet[0]) &&
                sameType(t1.unionSet[1], t2.unionSet[1]);
        case "intersect":
            return sameType(t1.intersectSet[0], t2.intersectSet[0]) &&
                sameType(t1.intersectSet[1], t2.intersectSet[1]);
        case "dynkey":
            return t1.keySymbol == t2.keySymbol;
        case "tagged_type":
            return sameType(t1.tagInnertype, t2.tagInnertype) && JSON.stringify(t1.tagData) == JSON.stringify(t2.tagData);
        case "object":
            if(t1.objKey === null)
                return t2.objKey === null;
            return sameType(t1.objKey, t2.objKey) && 
                sameType(t1.objValue, t2.objValue) && 
                sameType(t1.objParent, t2.objParent);
        case "function":
            if(t1.funcParams.length != t2.funcParams.length)
                return false;
            // Verify all arguments and result are same.
            return t1.funcParams.reduce(
                (acc, curr, ind) => acc && sameType(curr, t2.funcParams[ind]),
                sameType(t1.funcResult, t2.funcResult)
            );
        default:
            // Primitives are equal if symbols are equal.
            return true;
    }
}
typing.sameType = sameType;

let intoTup = (type) => {
    return {
        type: type,
        props: []
    }
};

let isObject = (type) => {
    type = removeTag(type);
    if (type.typeSym == typeSyms.union)
        return isObject(type.unionSet[0]) && isObject(type.unionSet[1]);
    if (type.typeSym === typeSyms.object)
        return true;
    return false;
}
typing.isObject = isObject;

let getObjectKeys = (obj) => {
    obj = removeTag(obj);
    if (!isObject(obj))
        return types.never;
    if (obj.typeSym == typeSyms.union)
        return createUnion(
            getObjectKeys(obj.unionSet[0]),
            getObjectKeys(obj.unionSet[1]),
        );
    if (obj.objKey === null)
        return types.never;
    return createUnion(obj.objKey, getObjectKeys(obj.objParent));
}
typing.getObjectKeys = getObjectKeys;

let createUnion = (t1, t2) => {
    if (isSubtype(t1, t2))
        return t2;
    if (isSubtype(t2, t1))
        return t1;
    return {
        typeSym: typeSyms.union,
        unionSet: [t1, t2]
    };
}
typing.createUnion = createUnion;

let createIntersection = (t1, t2) => {
    if (isSubtype(t1, t2))
        return t1;
    if (isSubtype(t2, t1))
        return t2;
    if (typeDoesntIntersect(t1, t2)) {
        // console.warn(`Intersection of non-intersecting types results in Never: ${prettyPrintType(t1)} and ${prettyPrintType(t2)}`);
        return types.never;
    }
    // According to type hierarchy, unions should be above intersections.
    if (t1.typeSym == typeSyms.union) {
        return createUnion(
            createIntersection(t1.unionSet[0], t2),
            createIntersection(t1.unionSet[1], t2),
        );
    }
    if (t2.typeSym == typeSyms.union) {
        return createUnion(
            createIntersection(t1, t2.unionSet[0]),
            createIntersection(t1, t2.unionSet[1]),
        );
    }
    return {
        typeSym: typeSyms.intersect,
        intersectSet: [t1, t2]
    };
}
typing.createIntersection = createIntersection;

let createFunction = (result, ...params) => {
    return {
        typeSym: typeSyms.function,
        funcResult: result,
        funcParams: params
    }
}
typing.createFunction = createFunction;

let createKey = (supertype, symbolName="Key") => {
    if (typeof supertype === "string")
        return supertype;
    return {
        typeSym: typeSyms.dynkey,
        keySymbol: freshSym(symbolName),
        keySupertype: supertype
    }
}
typing.createKey = createKey;

let keyval = (key, value) => {
    return {
        typeSym: typeSyms.keyval,
        keyvalKey: key,
        keyvalValue: value
    }
}
typing.keyval = keyval;

let removeTag = (type) => {
    if (type.typeSym != typeSyms.tagged_type)
        return type;
    return removeTag(type.tagInnertype);
}
typing.removeTag = removeTag;

let createTaggedType = (tag, data, innerType) => {
    return {
        typeSym: typeSyms.tagged_type,
        tag: tag,
        tagData: data,
        tagInnertype: innerType
    };
}
typing.createTaggedType = createTaggedType

let objBuilder = () => {
    let obj = {
        typeSym: typeSyms["object"], 
        objKey: null,
        objValue: null,
        objParent: null
    };
    let builderObj = {
        add: (key, value) => {
            obj = {
                typeSym: typeSyms["object"], 
                objKey: key,
                objValue: value,
                objParent: obj
            };
            return builderObj;
        },
        build: () => {
            return obj;
        }
    };
    return builderObj;
}
typing.objBuilder = objBuilder;

let createSimpleObject = (obj) => {
    let builder = objBuilder();
    for (let key of Object.keys(obj)) {
        builder.add(key, obj[key]);
    }
    return builder.build();
}
typing.createSimpleObject = createSimpleObject;

let createVec = (vecType, keyType, dim, dataType) => {
    if (dim == 0)
        return dataType;
    return createTaggedType(vecType, {dim: dim},
        objBuilder().add(createKey(keyType), createVec(vecType, keyType, dim - 1, dataType)).build()
    );
}
typing.createVec = createVec;

typing.createVecs = (vecType, keyType, dim, dataTypes) => {
  let keyTy = typing.createKey(keyType)
  if (dim == 1)
      return dataTypes.map(dataType => typing.createTaggedType(vecType, {dim: dim},
          typing.objBuilder().add(keyTy, dataType).build()));
  return typing.objBuilder().add(keyTy, typing.createVec(vecType, keyType, dim - 1, dataTypes)).build().map(ty => typing.createTaggedType(vecType, {dim: dim}, ty));
}

let performObjectGet = (objectTup, keyTup) => {
    switch (objectTup.type.typeSym) {
        case typeSyms.tagged_type:
            return performObjectGet(
                {type: removeTag(objectTup.type), props: objectTup.props},
                keyTup);
        case typeSyms.union:
            let res1 = performObjectGet({type: objectTup.type.unionSet[0], props: objectTup.props}, keyTup);
            let res2 = performObjectGet({type: objectTup.type.unionSet[1], props: objectTup.props}, keyTup);
            return {
                type: createUnion(res1.type, res2.type),
                props: union(res1.props, res2.props)
            };
        case typeSyms.object:
            if (objectTup.type.objValue === null) {
                return {
                    type: types.never,
                    props: nothingSet
                };
            }
            let keyType = objectTup.type.objKey;
            let valueType = objectTup.type.objValue;
            let parent = objectTup.type.objParent;
            let props = union(objectTup.props, keyTup.props);
            if (isSubtype(keyTup.type, keyType)) {
                return {
                    type: valueType, props: props
                };
            }
            let {type: t3, props: p3} = performObjectGet(intoTup(parent), keyTup);
            props = union(props, p3);
            if (typeDoesntIntersect(keyType, keyTup.type)) {
                return {
                    type: t3,
                    props: props
                };
            }
            return {
                type: createUnion(valueType, t3),
                props: props
            };
        case typeSyms.never:
            return {
                type: types.never,
                props: nothingSet
            };
        default:
            throw new Error("Unable to perform access on non-object type: " + prettyPrintType(objectTup.type));
    }
}
typing.performObjectGet = performObjectGet;

const SUBTYPE_ORDERS = [
    [types.u8, types.u16, types.u32, types.u64],
    [types.i8, types.i16, types.i32, types.i64],
    [types.u8, types.i16, types.i32, types.i64],
    [types.u16, types.i32, types.i64],
    [types.u32, types.i64],
    [types.i8, types.i16, types.f32, types.f64],
    [types.u8, types.u16, types.f32, types.f64],
    [types.u8, types.u16, types.i32, types.f64],
    [types.u32, types.f64],
];

let typeConforms_NonUnion = (type, expectedType) => {
    if (sameType(type, expectedType))
        return true;
    // Never is a subtype of all types.
    if (type.typeSym == typeSyms.never)
        return true;
    // Any is a supertype of all types.
    if (expectedType.typeSym == typeSyms.any)
        return true;
    // There is no type (other than any) that is a supertype of any.
    if (type.typeSym == typeSyms.any)
        return false;
    // There is no type (other than never) that is a subtype of never.
    if (expectedType.typeSym == typeSyms.never)
        return false;
    
    if (typeof type === "string" && expectedType.typeSym === typeSyms.string)
        return true;
    if (type.typeSym === typeSyms.tagged_type)
        type = type.tagInnertype;
    if (expectedType.typeSym === typeSyms.tagged_type)
        expectedType = expectedType.tagInnertype;

    if (expectedType.typeSym === typeSyms.dynkey) {
        // If expected type is a dynamic key, there is no guarantee of what it could be. It could be empty. As such, it has no guaranteed subtypes.
        // It could only be a subtype of itself, but we already know s1Type != s2Type.
        return false;
    }
    if (type.typeSym === typeSyms.dynkey) {
        // If supertype of dynkey is subtype of s2, then dynkey is subtype of s2.
        if (typeConforms(type.keySupertype, expectedType))
            return true;
    }
    if (type.typeSym === typeSyms.function) {
        if (expectedType.typeSym !== typeSyms.function)
            return false;
        // For function subtyping rules:
        //  S_1 <: T_1 yields T_1 -> any <: S_1 -> any
        //  S_2 <: T_2 yields any -> S_2 <: any -> T_2
        // So given the two, T_1 -> S_2 <: S_1 -> T_2
        if (type.funcParams.length !== expectedType.funcParams.length)
            return false;
        let resConforms = typeConforms(type.funcResult, expectedType.funcResult);
        if (!resConforms)
            return false;
        let argsConform = type.funcParams.reduce(((acc, _, i) => acc &&
            typeConforms(expectedType.funcParams[i], type.funcParams[i])),
            true
        );
        if (!argsConform)
            return false;
        return true;
    }
    if (isObject(type) && isObject(expectedType)) {
        // Because this is the non-union function, this guarantees they are true objects.
        if (expectedType.objKey === null) {
            // Empty object is supertype of all objects.
            return true;
        }
        if (type.objKey === null) {
            // Empty object is not a subtype of any non-empty object.
            return false;
        }
        let keyvals = [];
        let tup = intoTup(type);
        for (let nestedObj = expectedType; nestedObj.objKey != null; nestedObj = nestedObj.objParent) {
            let key = nestedObj.objKey;
            let {type: lookupType, props: lookupProps} = performObjectGet(tup, intoTup(key));
            let expectedRes = nestedObj.objValue;
            for (let keyval of keyvals) {
                if (typeDoesntIntersect(key, keyval[0]))
                    continue;
                expectedRes = createUnion(expectedRes, keyval[1])
            }
            if (!isSubtype(lookupType, expectedRes) || lookupProps.length != 0) {
                return false;
            }
            keyvals.push([nestedObj.objKey, nestedObj.objValue]);
        }
        return true;
    }
    for (let subtype_order_arr of SUBTYPE_ORDERS) {
        let i1 = subtype_order_arr.indexOf(type);
        if (i1 === -1)
            continue;
        let i2 = subtype_order_arr.indexOf(expectedType);
        if (i2 === -1)
            continue;
        if (i1 < i2)
            return true;
    }
    return false;
}

// typeConforms is same as isSubtype.
let typeConforms = (type, expectedType) => {
    if (sameType(type, expectedType))
        return true;
    switch (type.typeSym) {
        case typeSyms.union: {
            let res1 = typeConforms(type.unionSet[0], expectedType);
            let res2 = typeConforms(type.unionSet[1], expectedType);
            return res1 && res2;
        }
        case typeSyms.intersect: {
            let res1 = typeConforms(type.intersectSet[0], expectedType);
            let res2 = typeConforms(type.intersectSet[1], expectedType);
            return res1 || res2;
        }
        default:
            // TODO: Dynamic Keys supertype Union.
            switch (expectedType.typeSym) {
                case typeSyms.union: {
                    let res1 = typeConforms(type, expectedType.unionSet[0]);
                    let res2 = typeConforms(type, expectedType.unionSet[1]);
                    return res1 || res2;
                }
                case typeSyms.intersect: {
                    let res1 = typeConforms(type, expectedType.intersectSet[0]);
                    let res2 = typeConforms(type, expectedType.intersectSet[1]);
                    return res1 && res2;
                }
                default:
                    return typeConforms_NonUnion(type, expectedType);
            }
    }
}
let isSubtype = typeConforms;
typing.typeConforms = typeConforms;
typing.isSubtype = typeConforms; // Alias

let typeDoesntIntersect = (t1, t2) => {
    switch (t1.typeSym) {
        case typeSyms.never:
            return true;
        case typeSyms.any:
            if (t2.typeSyms == typeSyms.never)
                return true;
            return false;
        case typeSyms.union: {
            let res1 = typeDoesntIntersect(t1.unionSet[0], t2);
            let res2 = typeDoesntIntersect(t1.unionSet[1], t2);
            return res1 && res2;
        }
        default:
            break;
    }
    switch(t2.typeSym) {
        case typeSyms.never:
            return true;
        case typeSyms.any:
            return false;
        case typeSyms.union: {
            let res1 = typeDoesntIntersect(t2.unionSet[0], t1);
            let res2 = typeDoesntIntersect(t2.unionSet[1], t1);
            return res1 && res2;
        }
        default:
            break;
    }
    if (isSubtype(t1, t2) || isSubtype(t2, t1)) {
        return false;
    }
    let strT1 = "";
    let strT2 = "";
    if(isNumber(t1))
        strT1 = "num";
    if(isNumber(t2))
        strT2 = "num";
    if(isString(t1))
        strT1 = "str";
    if(isString(t2))
        strT2 = "str";
    if(isBoolean(t1))
        strT1 = "bool";
    if(isBoolean(t2))
        strT2 = "bool";
    if(strT1 != "" && strT2 != "")
        if(strT1 != strT2)
            return true;
    if (isString(t1) && isString(t2)) {
        if (t1.typeSym == typeSyms.dynkey || t2.typeSym == typeSyms.dynkey)
            return false;
        return true;
    }
    // TODO Other checks?
    return false;
}
typing.typeDoesntIntersect = typeDoesntIntersect;

let isInteger = (type) => {
    type = removeTag(type);
    if (type.typeSym === typeSyms.union)
        // Validate that every value in the union is a integer. Hence overall, it is a integer.
        return isInteger(type.unionSet[0]) && isInteger(type.unionSet[1]);
    if (type.typeSym === typeSyms.intersect)
        return isInteger(type.intersectSet[0]); // Intersections must be able to overlap. Hence, if one is an integer, the entire type is an integer.
    if (type.typeSym === typeSyms.dynkey)
        // Dynkeys are subtypes of the supertype. Hence, if supertype is integer, dynkey is integer.
        return isInteger(type.keySupertype);
    if (type.typeSym === typeSyms.u8 || 
        type.typeSym === typeSyms.u16 || 
        type.typeSym === typeSyms.u32 || 
        type.typeSym === typeSyms.u64 || 
        type.typeSym === typeSyms.i8 || 
        type.typeSym === typeSyms.i16 || 
        type.typeSym === typeSyms.i32 || 
        type.typeSym === typeSyms.i64)
        return true;
    return false;
}
typing.isInteger = isInteger;

let isNumber = (type) => {
    if (isInteger(type))
        return true;
    type = removeTag(type);
    if (type.typeSym === typeSyms.union)
        return isNumber(type.unionSet[0]) && isNumber(type.unionSet[1]);
    if (type.typeSym === typeSyms.intersect)
        return isNumber(type.intersectSet[0]);
    if (type.typeSym === typeSyms.dynkey)
        return isNumber(type.keySupertype);
    if (type.typeSym === typeSyms.f32 || type.typeSym === typeSyms.f64)
        return true;
    return false;
}
typing.isNumber = isNumber;

let isBoolean = (type) => {
    type = removeTag(type);
    if (type.typeSym === typeSyms.union)
        return isBoolean(type.unionSet[0]) && isBoolean(type.unionSet[1]);
    if (type.typeSym === typeSyms.intersect)
        return isBoolean(type.intersectSet[0]);
    if (type.typeSym === typeSyms.dynkey)
        return isBoolean(type.keySupertype);
    if (type.typeSym === typeSyms.boolean)
        return true;
    return false;
}
typing.isNumber = isNumber;

let isSparse = (type) => {
  return type.typeSym === typeSyms.tagged_type && type.tag === "sparse"
}

typing.isSparse = isSparse;

let isSparseVec = (type) => {
  return isSparse(type) && type.tagData.dim == 1
}

typing.isSparseVec = isSparseVec;

let isSparseMat = (type) => {
  return isSparse(type) && type.tagData.dim == 2
}

typing.isSparseMat = isSparseMat;

let isDense = (type) => {
    return type.typeSym === typeSyms.tagged_type && type.tag === "dense"
}
typing.isDense = isDense;

let generalizeNumber = (type) => {
    if (!isNumber(type))
        throw new Error("Unable to generalize non-number value.");
    switch (type.typeSym) {
        case typeSyms.union:
            return createUnion(
                generalizeNumber(type.unionSet[0]),
                generalizeNumber(type.unionSet[1])
            );
        case typeSyms.intersect:
            // TODO: Intersection of integers.
            return createUnion(
                generalizeNumber(type.intersectSet[0]),
                generalizeNumber(type.intersectSet[1]),
            );
        case typeSyms.dynkey:
            return generalizeNumber(type.keySupertype);
        case typeSyms.tagged_type:
            return generalizeNumber(type.tagInnertype);
        default:
            return type;
    }
}

// Same as integer except for strings. Includes string literals.
let isString = (type) => {
    if (type.typeSym === typeSyms.union)
        return isString(type.unionSet[0]) && isString(type.unionSet[1]);
    type = removeTag(type);
    if (type.typeSym === typeSyms.dynkey)
        return isString(type.keySupertype);
    if (type.typeSym === typeSyms.string)
        return true;
    if (typeof type === "string")
        return true;
    return false;
}

typing.isString = isString

let prettyPrintType = (schema) => {
    if (schema === undefined)
        return "~Undefined~";
    if (schema === null)
        return "~Null~";
    if (schema.typeSym in types)
        return schema.typeSym
    if (typeof schema === "string")
        return "\"" + schema + "\"";
    if (schema.typeSym === typeSyms.union)
        return "(" + Array.from(schema.unionSet).map(type => prettyPrintType(type)).join(" | ") + ")";
    if (schema.typeSym === typeSyms.function)
        return "(" + schema.funcParams.map(type => prettyPrintType(type)).join(", ") + ") -> " + prettyPrintType(schema.funcResult);
    if (schema.typeSym === typeSyms.dynkey)
        return "<"+prettyPrintType(schema.keySupertype)+">";
    if (schema.typeSym === typeSyms.tagged_type)
        return schema.tag +":"+prettyPrintType(schema.tagInnertype);
    if (isObject(schema)) {
        if (schema.objKey === null)
            return "{}";
        else
            return `${prettyPrintType(schema.objParent)}{${prettyPrintType(schema.objKey)}: ${prettyPrintType(schema.objValue)}}`;
    }
    if (typeof schema === "object")
        return "~UNK:" + JSON.stringify(schema) + "~";
    return "~Invalid~";
}
typing.prettyPrintType = prettyPrintType;

let prettyPrintTuple = (tuple) => {
    if (tuple === undefined)
        return "~Undefined~";
    let propStr = "";
    if (tuple.props.includes(props.nothing)) {
        if (tuple.props.includes(props.error))
            propStr = "N,E";
        else
            propStr = "N";
    } else if (tuple.props.includes(props.error))
        propStr = "E";
    else
        propStr = "/";
    return prettyPrintType(tuple.type) + " | " + propStr;
}
typing.prettyPrintTuple = prettyPrintTuple;

let indent = (str) => str.split("\n").join("\n  ");

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
        return types.never;
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

let symIndex = 0;
let freshSym = (pref) => pref + (symIndex++);

let validateIRQuery = (schema, cseMap, boundKeys, nonEmptyGuarantees, q) => {
    // if (q.schema) {
    //     return q.schema;
    // }
    let res = _validateIRQuery(schema, cseMap, boundKeys, nonEmptyGuarantees, q);
    q.schema = res;
    //console.log(prettyPrint(q) + " : " + prettyPrintTuple(res));
    return res;
};

let _validateIRQuery = (schema, cseMap, boundKeys, nonEmptyGuarantees, q) => {
    let $validateIRQuery = (newQ) => {
        return validateIRQuery(schema, cseMap, boundKeys, nonEmptyGuarantees, newQ);
    }
    if (q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return intoTup(schema);
    } else if (q.key === "loadInput") {
        let argTups = q.arg.map($validateIRQuery);
        let t1 = argTups[0].type;
        if (!isString(t1)) {
            throw new Error("Filename in loadInput expected to be a string but got " + prettyPrintType(t1))
        }
        return {type: q.schema, props: argTups[0].props};
    } else if (q.key === "const") {
        if (typeof q.op === "object" && Object.keys(q.op).length === 0)
            return intoTup(createSimpleObject({}));
        if (typeof q.op === "number") {
            if (q.op < 0) {
                if (q.op >= -127)
                    return intoTup(types.i8);
                if (q.op >= -32767)
                    return intoTup(types.i16);
                if (q.op >= -2147483647)
                    return intoTup(types.i32);
                return intoTup(types.i64);
            }
            if (q.op < 256)
                return intoTup(types.u8);
            if (q.op <= 65535)
                return intoTup(types.u16);
            if (q.op <= 4294967295)
                return intoTup(types.u32);
            return intoTup(types.u64);
        }
        if (typeof q.op === "string")
            return intoTup(q.op);
        throw new Error("Unknown const: " + q.op)
    } else if (q.key === "var") {
        
        if (boundKeys[q.op] === undefined) {
            throw new Error("Unable to determine type of variable, given no context.");
        }
        return boundKeys[q.op];

    } else if (q.key === "get") {
        let tup1 = $validateIRQuery(q.arg[0]);

        let t1 = tup1.type;
        if (!isObject(t1)) {
            throw new Error("Unable to perform get operation on non-object: " + prettyPrintType(t1));
        }
        
        // TODO: Move this into a higher up function ran over the AST.
        // to include intersections of domains and fixpoint calculations.
        let e2 = q.arg[1];

        if (e2.key == "var") {
            if (!boundKeys[e2.op]) {
                let keys = getObjectKeys(t1);
                boundKeys[e2.op] = {
                    type: keys,
                    props: []//nonEmpty(keys)
                };
            }
        }
        let tup2 = $validateIRQuery(q.arg[1]);
        
        return performObjectGet(tup1, tup2);
    } else if (q.key === "pure") {
        let argTups = q.arg.map($validateIRQuery);
        let {type: t1, props: p1} = argTups[0];

        if (q.op == "apply") {
            if (t1.typeSym != typeSyms.function)
                throw new Error(`Unable to apply a value to a non-function value (type ${prettyPrintType(t1)})`)
            if (t1.funcParams.length + 1 != argTups.length)
                throw new Error(`Unable to apply function. Number of args do not align.`);
            let props = [];
            for (let i = 0; i < argTups.length - 1; i++) {
                let {type, props: argProps} = argTups[i + 1];
                let expType = t1.funcParams[i];
                if (!isSubtype(type, expType)) {
                    throw new Error(`Unable to apply function. Argument ${i + 1} does not align.\nExpected: ${prettyPrintType(expType)}\nReceived: ${prettyPrintType(type)}.`);
                }
                props = union(props,argProps);
            }
            // All inputs conform.
            return {type: t1.funcResult, props};
        }
        // If q is a binary operation:
        // TODO: Figure out difference between fdiv and div.
        else if (q.op === "equal" || q.op === "and" || q.op === "notEqual" || q.op === "fdiv" || 
            q.op === "plus" || q.op === "minus" || q.op === "times" || q.op === "div" || q.op === "mod") {
            let {type: t2, props: p2} = argTups[1];
            if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "div" || q.op == "mod") {
                if (!isNumber(t1) || !isNumber(t2))
                    throw new Error(`Unable to perform ${q.op} on values of type ${prettyPrintType(t1)} and ${prettyPrintType(t2)}`);
                let resType = generalizeNumber(createUnion(t1, t2));
                return {
                    type: resType,
                    props: union(p1,p2)
                };
            } else if (q.op == "fdiv") {
                // TODO: validate types for fdiv
                return {type: types.f64, props: union(p1,p2)};
            } else if (q.op == "equal") {
                // TODO: validate types for equal
                return {type: types.boolean, props: union(p1,p2)};
            } else if (q.op == "notEqual") {
                // TODO: validate types for notEqual
                return {type: types.boolean, props: union(p1,p2)};
            } else if (q.op == "and") {
                // TODO: validate types for and
                return {type: t2, props: p2};
            }
            throw new Error("Pure operation not implemented: " + q.op);
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key === "hint") {

        return {type: types.never, props: []};

    } else if (q.key === "mkset") {
        let argTups = q.arg.map($validateIRQuery);

        let keyType = argTups[0].type;
        let key = createKey(keyType, "Mkset");
        // If argument always returns atleast one value, add a non-empty guarantee.
        if (!argTups[0].props.includes(props.nothing))
            nonEmptyGuarantees.push(key);
        return {
            type: objBuilder()
                .add(key, types.boolean)
                .build(),
            props: diff(argTups[0].props,nothingSet)
        }

    } else if (q.key === "prefix") {

        throw new Error("Unimplemented");

    } else if (q.key === "stateful") {
        // TODO Fix order once filter variables are moved to top level.
        let argTups = q.arg.map($validateIRQuery);

        let argTup = argTups[0];
        let argType = argTup.type;
        if (sameType(argType, types.never))
            throw new Error("Unable to evaluate stateful expression on never type.");

        if (q.op === "sum" || q.op === "product") {
            // Check if each arg is a number.
            if (!isNumber(argType))
                throw new Error(`Unable to ${q.op} non-number values currently. Got: ${prettyPrintType(argType)}`);
            
            return {type: argType, props: diff(argTup.props,nothingSet)};
        } else if (q.op === "min" || q.op === "max") {

            if (!isNumber(argType))
                throw new Error("Unable to union non-number values currently.");

            return  {type: argType, props: argTup.props};

        } else if (q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.u32, props: diff(argTup.props,nothingSet)};
        } else if (q.op === "single" || q.op === "first" || q.op === "last") {
            // Propagate both type and properties.
            return argTup;
        } else if (q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.
            // TODO: See if we should default to size of array as u32 here.
            let key = createKey(types.u32, "Array");
            // If argument always returns atleast one value, add a non-empty guarantee.
            if (!argTup.props.includes(props.nothing))
                nonEmptyGuarantees.push(key);
            return {
                type: objBuilder()
                    .add(key, argType).build(), 
                props: diff(argTup.props,nothingSet)
            };
        } else if (q.op === "print") {
            return {type: types.never, props: []};
        }

        throw new Error("Unimplemented stateful expression " + q.op);

    } else if (q.key === "group") {
        throw new Error("Unimplemented");
        let [e1, e2] = q.arg;
        let t1 = validateIRQuery(schema, cseMap, boundKeys, e1);
        let t2 = validateIRQuery(schema, cseMap, boundKeys, e2);
        if (!sameType(t1, types.string) && !typing.isKeySym(t2))
            throw new Error("Unable to use non-string field as key. Found: " + prettyPrintType(t1));
        //return "{ "+ e1 + ": " + e2 + " }"
        //return {"*": t2};
    } else if (q.key === "update") {
        if (q.arg[3])  $validateIRQuery(q.arg[3]);
        let argTup1 = $validateIRQuery(q.arg[0]);
        let argTup3 = $validateIRQuery(q.arg[2]);
        let argTup2 = $validateIRQuery(q.arg[1]);

        let {type: parentType, props: p1} = argTup1;
        if (!isObject(parentType))
            throw new Error("Unable to update field of type: " + prettyPrintType(parentType));
        //let t3 = argTups[2].type;
        if (q.arg[1].op === "vars") {
            throw new Error("Unimplemented");
            /*
            // Old object code. Needs to be completely rewritten.
            let currObj = t3;
            for (let i = e2.arg.length - 1; i >= 0; i--) {
                let keyVar = e2.arg[i];
                let keyVarType = $validateIRQuery(keyVar);
                if (!isInteger(keyVarType) && !isString(keyVarType))
                    throw new Error("Unable to use type: " + prettyPrintType(keyVarType) + " as object key");
                if (i === 0) {
                    return [[keyVarType, currObj], ...t1];
                } else {
                    currObj = [[keyVarType, currObj]];
                }
            }*/
        }
        let {type: keyType, props: p2} = argTup2;
        let {type: valueType, props: p3} = argTup3;
        if (!isInteger(keyType) && !isString(keyType))
            throw new Error("Unable to use type: " + prettyPrintType(keyType) + " as object key");

        let props = union(p2, p3);
        let key = createKey(keyType, "update");
        // If the key and value are not nothing, then the key must not be empty.
        // TODO: Determine if this is true given free variable constraints.
        if (!props.includes(props.nothing))
            nonEmptyGuarantees.push(key);
        return {
            type: {
                typeSym: typeSyms.object,
                objKey: key,
                objValue: valueType,
                objParent: parentType
            },
            props: union(diff(props, nothingSet), p1)
        };
    }
    throw new Error("Unable to determine type of query: " + prettyPrint(q));
}

// Used for converting human-readable types into their proper format.
typing.parseType = (schema) => {
    if (schema === undefined)
        return undefined;
    if (typeof schema === "string")
        return schema;
    if (typeof schema !== "object")
        throw new Error("Unknown type: " + schema);
    switch (schema.typeSym) {
        case undefined:
            if (Object.keys(schema).length == 0) {
                return typing.createSimpleObject({});
            }
            let key = Object.keys(schema)[Object.keys(schema).length - 1];
            let value = typing.parseType(schema[key]);
            // Create new schema without key, without mutating the existing object.
            let {[key]: _, ...newSchema} = schema;
            // If keyval is used, extract the pair.
            if (value.typeSym == typeSyms.keyval) {
                key = typing.parseType(value.keyvalKey);
                value = typing.parseType(value.keyvalValue);
            }
            // Recurse until the base object is reached, then construct object.
            let parent = typing.parseType(newSchema);
            return {
                typeSym: typeSyms.object,
                objKey: key,
                objValue: value,
                objParent: parent
            };
        case typeSyms.union:
            schema.unionSet[0] = typing.parseType(schema.unionSet[0]);
            schema.unionSet[1] = typing.parseType(schema.unionSet[1]);
            return schema;
        case typeSyms.intersect:
            schema.intersectSet[0] = typing.parseType(schema.intersectSet[0]);
            schema.intersectSet[1] = typing.parseType(schema.intersectSet[1]);
            return schema;
        case typeSyms.dynkey:
            schema.keySupertype = typing.parseType(schema.keySupertype)
            return schema;
        case typeSyms.function:
            schema.funcParams = schema.funcParams.map(typing.parseType);
            schema.funcResult = typing.parseType(schema.funcResult);
            return schema;
        case typeSyms.object:
            if (schema.objKey === null)
                return schema;
            schema.objKey = typing.parseType(schema.objKey);
            schema.objValue = typing.parseType(schema.objValue);
            schema.objParent = typing.parseType(schema.objParent);
            return schema;
        case typeSyms.tagged_type:
            schema.tagInnertype = typing.parseType(schema.tagInnertype);
            return schema;
        case typeSyms.tagged_type:
            schema.tagInnertype = typing.parseType(schema.tagInnertype);
            return schema;
        default:
            return schema;
    }
}

typing.validateIR = (schema, q) => {
    if (schema === undefined)
        return undefined;
    schema = typing.parseType(schema);
    let boundKeys = {};
    let cseMap = {};
    let nonEmptyGuarantees = [];
    let res = validateIRQuery(schema, cseMap, boundKeys, nonEmptyGuarantees, q);
    //console.log(prettyPrintType(res));
    return res;
}