
let typing = {}
let types = {}
let typeSyms = {}
let props = {}
exports.typing = typing;
exports.types = types;
exports.typeSyms = typeSyms;
exports.props = props;


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
let nothingSet = new Set([props.nothing]);
let errorSet = new Set([props.error]);

// u8 <: i16, u16 <: i32, u32 <: i64
// Implicitly or explicitly convert signed to unsigned, and unsigned to same-size signed when needed?
// And also consider conversion between floats and integers.

typeSyms["object"] = "object"; // {}{K: V}{K2: V2}...
typeSyms["intersect"] = "intersect"; // arg1 n arg2 n arg3 ...
typeSyms["union"] = "union"; // arg1 U arg2 U arg3 ...
typeSyms["dynkey"] = "dynkey"; // wrapped arg is subtype of arg
typeSyms["function"] = "function"; // (p1, p2, ...) -> r1
typeSyms["tagged_type"] = "tagged_type"; // object with a specialized interface to it used by codegen.

// Type hierarchy order: (Top to bottom level)
// - Unions
// - Intersections
// - TaggedTypes
// - Base Types
// -- Then inside any base types (e.g. K_n(T) ), the hierarchy restarts for said inner types.

let typeEquals = (t1, t2) => {
    // All types that can be condensed should be condensed (according to type hierarchy)
    if(t1.typeSym != t2.typeSym)
        return false;
    switch(t1.typeSym) {
        case typeSyms.union: {
            let t1t1 = t1.unionSet[0];
            let t1t2 = t1.unionSet[1];
            let t2t1 = t2.unionSet[0];
            let t2t2 = t2.unionSet[1];
            if(typeEquals(t1t1, t2t1) && typeEquals(t1t2, t2t2))
                return true;
            if(typeEquals(t1t1, t2t2) && typeEquals(t1t2, t2t1))
                return true;
            return false;
        }
        case typeSyms.intersect: {
            let t1t1 = t1.intersectSet[0];
            let t1t2 = t1.intersectSet[1];
            let t2t1 = t2.intersectSet[0];
            let t2t2 = t2.intersectSet[1];
            if(typeEquals(t1t1, t2t1) && typeEquals(t1t2, t2t2))
                return true;
            if(typeEquals(t1t1, t2t2) && typeEquals(t1t2, t2t1))
                return true;
            return false;
        }
        case typeSyms.dynkey: {
            // If two keys have the same symbol, they are same by definition.
            if(t1.keySymbol == t2.keySymbol)
                return true;
        }
        case typeSyms.tagged_type: {
            throw new Error("unimplemented");
        }
        case typeSyms.object: {
            if(t1.objKey === null)
                return t2.objKey === null;
            if(!typeEquals(t1.objKey, t2.objKey))
                return false;
            if(!typeEquals(t1.objValue, t2.objValue))
                return false;
            if(!typeEquals(t1.objParent, t2.objParent))
                return false;
            return true;
        }
        default: {
            return t1 == t2;
        }
    }
}

let isObject = (type) => {
    type = removeTag(type);
    if(type.typeSym == typeSyms.union)
        return isObject(type.unionSet[0]) && isObject(type.unionSet[1]);
    if(type.typeSym === typeSyms.object)
        return true;
    return false;
}
typing.isObject = isObject;

let getObjectKeys = (obj) => {
    obj = removeTag(obj);
    if(!isObject(obj))
        return types.never;
    if(obj.typeSym == typeSyms.union)
        return createUnion(
            getObjectKeys(obj.unionSet[0]),
            getObjectKeys(obj.unionSet[1]),
        );
    if(obj.objKey === null)
        return types.never;
    return createUnion(obj.objKey, getObjectKeys(obj.objParent));
}
typing.getObjectKeys = getObjectKeys;

let createUnion = (t1, t2) => {
    if(isSubtype(t1, t2))
        return t2;
    if(isSubtype(t2, t1))
        return t1;
    return {
        typeSym: typeSyms.union,
        unionSet: [t1, t2]
    };
}
typing.createUnion = createUnion;

let createIntersection = (t1, t2) => {
    if(isSubtype(t1, t2))
        return t1;
    if(isSubtype(t2, t1))
        return t2;
    if(typeDoesntIntersect(t1, t2)) {
        console.warn(`Intersection of non-intersecting types results in Never: ${prettyPritType(t1)} and ${prettyPrintType(t2)}`);
        return types.never;
    }
    // According to type hierarchy, unions should be above intersections.
    if(t1.typeSym == typeSyms.union) {
        return createUnion(
            createIntersection(t1.unionSet[0], t2),
            createIntersection(t1.unionSet[1], t2),
        );
    }
    if(t2.typeSym == typeSyms.union) {
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
typing.createUnion = createUnion;

let createFunction = (result, ...params) => {
    return {
        typeSym: typeSyms.function,
        funcResult: result,
        funcParams: params
    }
}
typing.createFunction = createFunction;

let createKey = (supertype, symbolName="Key") => {
    if(typeof supertype === "string")
        return supertype;
    return {
        typeSym: typeSyms.dynkey,
        keySymbol: freshSym(symbolName),
        keySupertype: supertype
    }
}
typing.createKey = createKey;

let removeTag = (type) => {
    if(type.typeSym != typeSyms.tagged_type)
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
    for(let key of Object.keys(obj)) {
        builder.add(key, obj[key]);
    }
    return builder.build();
}
typing.createSimpleObject = createSimpleObject;

let createVec = (vecType, keyType, dim, dataType) => {
    if(dim == 0)
        return dataType;
    return createTaggedType(vecType, {dim: dim},
        objBuilder().add(createKey(keyType), createVec(vecType, keyType, dim - 1, dataType)).build()
    );
}
typing.createVec = createVec;

typing.createVecs = (vecType, keyType, dim, dataTypes) => {
  let keyTy = typing.createKey(keyType)
  if(dim == 1)
      return dataTypes.map(dataType => typing.createTaggedType(vecType, {dim: dim},
          typing.objBuilder().add(keyTy, dataType).build()));
  return typing.objBuilder().add(keyTy, typing.createVec(vecType, keyType, dim - 1, dataTypes)).build().map(ty => typing.createTaggedType(vecType, {dim: dim}, ty));
}

let performObjectGet = (objectTup, keyTup) => {
    switch(objectTup.type.typeSym) {
        case typeSyms.tagged_type:
            return performObjectGet(
                {type: removeTag(objectTup.type), props: objectTup.props},
                keyTup);
        case typeSyms.union:
            let res1 = performObjectGet(objectTup.type.unionSet[0], keyType);
            let res2 = performObjectGet(objectTup.type.unionSet[1], keyType);
            return {
                type: createUnion(res1.type, res2.type),
                props: res1.props.union(res2.props)
            };
        case typeSyms.object:
            if(objectTup.type.objValue === null) {
                return {
                    type: types.never,
                    props: nothingSet
                };
            }
            let keyType = objectTup.type.objKey;
            let valueType = objectTup.type.objValue;
            let parent = objectTup.type.objParent;
            let props = objectTup.props.union(keyTup.props);
            if(isSubtype(keyTup.type, keyType)) {
                return {
                    type: valueType, props: props
                };
            }
            let {type: t3, props: p3} = performObjectGet({type: parent, props: new Set([])}, keyTup);
            props = props.union(p3);
            if(typeDoesntIntersect(keyType, keyTup.type)) {
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
];

let typeConforms_NonUnion = (type, expectedType) => {
    if(typeEquals(type, expectedType))
        return true;
    // Never is a subtype of all types.
    if(type == types.never)
        return true;
    // Any is a supertype of all types.
    if(expectedType == types.any)
        return true;
    // There is no type (other than any) that is a supertype of any.
    if(type == types.any)
        return false;
    // There is no type (other than never) that is a subtype of never.
    if(expectedType == types.never)
        return false;
    
    if(typeof type === "string" && expectedType === types.string)
        return true;
    if(type.typeSym === typeSyms.tagged_type)
        type = type.tagInnertype;
    if(expectedType.typeSym === typeSyms.tagged_type)
        expectedType = expectedType.tagInnertype;

    if(expectedType.typeSym === typeSyms.dynkey) {
        // If expected type is a dynamic key, there is no guarantee of what it could be. It could be empty. As such, it has no guaranteed subtypes.
        // It could only be a subtype of itself, but we already know s1Type != s2Type.
        return false;
    }
    if(type.typeSym === typeSyms.dynkey) {
        // If supertype of dynkey is subtype of s2, then dynkey is subtype of s2.
        if(typeConforms(type.keySupertype, expectedType))
            return true;
    }
    if(type.typeSym === typeSyms.function) {
        if(expectedType.typeSym !== typeSyms.function)
            return false;
        // For function subtyping rules:
        //  S_1 <: T_1 yields T_1 -> any <: S_1 -> any
        //  S_2 <: T_2 yields any -> S_2 <: any -> T_2
        // So given the two, T_1 -> S_2 <: S_1 -> T_2
        if(type.funcParams.length !== expectedType.funcParams.length)
            return false;
        let resConforms = typeConforms(type.funcResult, expectedType.funcResult);
        if(!resConforms)
            return false;
        let argsConform = type.funcParams.reduce((acc, _, i) => acc &&
            typeConforms(expectedType.funcParams[i], type.funcParams[i])
        );
        if(!argsConform)
            return false;
        return true;
    }
    if(isObject(type) && isObject(expectedType)) {
        throw new Error("Unable to check type conformity of objects.");
        if(expectedType.objKey === null) {
            // Empty object is supertype of all objects.
            return true;
        }
        let invalid = false;
        for(let keyValue of expectedType) {
            // If each potential access doesn't guarantee to have a subtype of the supertype's value for that field
            // then it could return a value that isn't in the supertype's type. So it doesn't conform.
            if(!isSubtype(performObjectGet(type, keyValue[0]), keyValue[1])) {
                invalid = true;
                break;
            }
        }
        if(!invalid)
            return true;
        return false;
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
let typeConforms = (type, expectedType) => {
    if(typeEquals(type, expectedType))
        return true;
    switch(type.typeSym) {
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
        case typeSyms.dynkey: {
            return typeConforms(type.keySupertype, expectedType);
        }
        default:
            // TODO: Dynamic Keys supertype Union.
            switch(expectedType.typeSym) {
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
    switch(t1.typeSym) {
        case typeSyms.never:
            return true;
        case typeSyms.any:
            if(t2 == types.never)
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
    if(t2.typSym == typeSyms.union) {
        let res1 = typeDoesntIntersect(t1, t2.unionSet[0]);
        let res2 = typeDoesntIntersect(t1, t2.unionSet[1]);
        return res1 && res2;
    }
    if(isSubtype(t1, t2) || isSubtype(t2, t1)) {
        return false;
    }
    if(isInteger(t1) && isString(t2))
        return true;
    if(isString(t1) && isInteger(t2))
        return true;
    if(isString(t1) && isString(t2)) {
        if(t1.typeSym == typeSyms.dynkey || t2.typeSym == typeSyms.dynkey)
            return false;
        return true;
    }
    // TODO Other checks?
    return false;
}

let isInteger = (type) => {
    type = removeTag(type);
    if(type.typeSym === typeSyms.union)
        // Validate that every value in the union is a integer. Hence overall, it is a integer.
        return isInteger(type.unionSet[0]) && isInteger(type.unionSet[1]);
    if(type.typeSym === typeSyms.intersect)
        return isInteger(type.intersectSet[0]); // Intersections must be able to overlap. Hence, if one is an integer, the entire type is an integer.
    if(type.typeSym === typeSyms.dynkey)
        // Dynkeys are subtypes of the supertype. Hence, if supertype is integer, dynkey is integer.
        return isInteger(type.keySupertype);
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

Set.prototype.difference = function(otherSet) {
  return new Set([...this].filter(element => !otherSet.has(element)));
};

let generalizeInteger = (type) => {
    if(!isInteger(type))
        throw new Error("Unable to generalize non-integer value.");
    switch(type.typeSym) {
        case typeSyms.union:
            return createUnion(
                generalizeInteger(type.unionSet[0]),
                generalizeInteger(type.unionSet[1])
            );
        case typeSyms.intersect:
            // TODO: Intersection of integers.
            return createUnion(
                generalizeInteger(type.intersectSet[0]),
                generalizeInteger(type.intersectSet[1]),
            );
        case typeSyms.dynkey:
            return generalizeInteger(type.keySupertype);
        case typeSyms.tagged_type:
            return generalizeInteger(type.tagInnertype);
        default:
            return type;
    }
}

// Same as integer except for strings. Includes string literals.
let isString = (type) => {
    if(type.typeSym === typeSyms.union)
        return isString(type.unionSet[0]) && isString(type.unionSet[1]);
    type = removeTag(type);
    if(type.typeSym === typeSyms.dynkey)
        return isString(type.keySupertype);
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
    if(schema.typeSym === typeSyms.union)
        return "(" + Array.from(schema.unionSet).map(type => prettyPrintType(type)).join(" | ") + ")";
    if(schema.typeSym === typeSyms.function)
        return "(" + schema.funcParams.map(type => prettyPrintType(type)).join(", ") + ") -> " + prettyPrintType(schema.funcResult);
    if(schema.typeSym === typeSyms.dynkey)
        return "<"+prettyPrintType(schema.keySupertype)+">";
    if(schema.typeSym === typeSyms.tagged_type)
        return schema.tag +":"+prettyPrintType(schema.tagInnertype);
    if(isObject(schema)) {
        if(schema.objKey === null)
            return "{}";
        else
            return `${prettyPrintType(schema.objParent)}{${prettyPrintType(schema.objKey)}: ${prettyPrintType(schema.objValue)}}`;
    }
    if(typeof schema === "object")
        return "~UNK:" + JSON.stringify(schema) + "~";
    return "~Invalid~";
}
typing.prettyPrintType = prettyPrintType;

let prettyPrintTuple = (tuple) => {
    if(tuple === undefined)
        return "~Undefined~";
    let propStr = "";
    if(tuple.props.has(props.nothing)) {
        if(tuple.props.has(props.error))
            propStr = "N,E";
        else
            propStr = "N";
    } else if(tuple.props.has(props.error))
        propStr = "E";
    else
        propStr = "/";
    return prettyPrintType(tuple.type) + " | " + propStr;
}
typing.prettyPrintTuple = prettyPrintTuple;

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
        return types.never;
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

let validateIRQuery = (schema, cseMap, boundKeys, nonEmptyGuarantees, q) => {
    // if(q.schema) {
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
    if(q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return {type: schema, props: new Set([])};
    } else if(q.key === "loadInput") {
        let argTups = q.arg.map($validateIRQuery);
        let t1 = argTups[0].type;
        if (!isString(t1)) {
            throw new Error("Filename in loadInput expected to be a string but got " + prettyPrintType(t1))
        }
        return {type: q.schema, props: argTups[0].props};
    } else if(q.key === "const") {
        if(typeof q.op === "object" && Object.keys(q.op).length === 0)
            return {type: createSimpleObject({}), props: new Set([])};
        if(typeof q.op === "number") {
            if(q.op < 0) {
                if(q.op >= -127)
                    return {type: types.i8, props: new Set([])};
                if(q.op >= -32767)
                    return {type: types.i16, props: new Set([])};
                if(q.op >= -2147483647)
                    return {type: types.i32, props: new Set([])};
                return {type: types.i64, props: new Set([])};
            }
            if(q.op < 256)
                return {type: types.u8, props: new Set([])};
            if(q.op <= 65535)
                return {type: types.u16, props: new Set([])};
            if(q.op <= 4294967295)
                return {type: types.u32, props: new Set([])};
            return {type: types.u64, props: new Set([])};
        }
        if(typeof q.op === "string")
            return {type: q.op, props: new Set([])};
        throw new Error("Unknown const: " + q.op)
    } else if(q.key === "var") {
        
        if(boundKeys[q.op] === undefined) {
            throw new Error("Unable to determine type of variable, given no context.");
        }
        return boundKeys[q.op];

    } else if(q.key === "get") {
        let tup1 = $validateIRQuery(q.arg[0]);

        let t1 = tup1.type;
        if(!isObject(t1)) {
            throw new Error("Unable to perform get operation on non-object: " + prettyPrintType(t1));
        }
        
        // TODO: Move this into a higher up function ran over the AST.
        // to include intersections of domains and fixpoint calculations.
        let e2 = q.arg[1];

        if(e2.key == "var") {
            if(!boundKeys[e2.op]) {
                let keys = getObjectKeys(t1);
                boundKeys[e2.op] = {
                    type: keys,
                    props: new Set([])//nonEmpty(keys)
                };
            }
        }
        let tup2 = $validateIRQuery(q.arg[1]);
        
        return performObjectGet(tup1, tup2);
    } else if(q.key === "pure") {
        let argTups = q.arg.map($validateIRQuery);
        let {type: t1, props: p1} = argTups[0];
        // If q is a binary operation:
        if(q.op === "plus" || q.op === "times"  || q.op === "equal" || q.op === "and" || q.op === "notEqual" ||
           q.op === "minus" || q.op === "times" || q.op === "fdiv" || q.op === "div" || q.op === "mod") {
            let {type: t2, props: p2} = argTups[1];
            if(q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "div" || q.op == "mod") {
                if(!isInteger(t1) || !isInteger(t2))
                    throw new Error(`Unable to perform ${q.op} on values of type ${prettyPrintType(t1)} and ${prettyPrintType(t2)}`);
                let resType = generalizeInteger(createUnion(t1, t2));
                return {
                    type: resType,
                    props: p1.union(p2)
                };
            } else if (q.op == "fdiv") {
                // TODO: validate types for fdiv
                return {type: types.f64, props: p1.union(p2)};
            } else if (q.op == "equal") {
                // TODO: validate types for equal
                return {type: types.boolean, props: p1.union(p2)};
            } else if (q.op == "notEqual") {
                // TODO: validate types for notEqual
                return {type: types.boolean, props: p1.union(p2)};
            } else if (q.op == "and") {
                // TODO: validate types for and
                return {type: t2, props: p2};
            }
            throw new Error("Pure operation not implemented: " + q.op);
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if(q.key === "hint") {

        return {type: types.never, props: new Set()};

    } else if(q.key === "mkset") {
        let argTups = q.arg.map($validateIRQuery);

        let keyType = argTups[0].type;
        let key = createKey(keyType, "Mkset");
        // If argument always returns atleast one value, add a non-empty guarantee.
        if(!argTups[0].props.has(props.nothing))
            nonEmptyGuarantees.push(key);
        return {
            type: objBuilder()
                .add(key, types.boolean)
                .build(),
            props: new Set(argTups[0].props.difference(nothingSet))
        }

    } else if(q.key === "prefix") {

        throw new Error("Unimplemented");

    } else if(q.key === "stateful") {
        // TODO Fix order once filter variables are moved to top level.
        let argTups = q.arg.map($validateIRQuery);

        let argTup = argTups[0];
        let argType = argTup.type;
        if(argType == types.never)
            throw new Error("Unable to evaluate stateful expression on never type.");

        if(q.op === "sum" || q.op === "product") {
            // Check if each arg is a number.
            if(!isInteger(argType))
                throw new Error(`Unable to ${q.op} non-integer values currently. Got: ${prettyPrintType(argType)}`);
            
            return {type: argType, props: argTup.props.difference(nothingSet)};
        } else if(q.op === "min" || q.op === "max") {

            if(!isInteger(argType))
                throw new Error("Unable to union non-integer values currently.");

            return  {type: argType, props: argTup.props};

        } else if(q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.u32, props: argTup.props.difference(nothingSet)};
        } else if(q.op === "single" || q.op === "first" || q.op === "last") {
            // Propagate both type and properties.
            return argTup;
        } else if(q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.
            // TODO: See if we should default to size of array as u32 here.
            let key = createKey(types.u32, "Array");
            // If argument always returns atleast one value, add a non-empty guarantee.
            if(!argTup.props.has(props.nothing))
                nonEmptyGuarantees.push(key);
            return {
                type: objBuilder()
                    .add(key, argType).build(), 
                props: argTup.props.difference(nothingSet)
            };
        } else if (q.op === "print") {
            return {type: types.never, props: new Set()};
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
        let _ = $validateIRQuery(q.arg[3]);
        let argTup1 = $validateIRQuery(q.arg[0]);
        let argTup2 = $validateIRQuery(q.arg[1]);
        let argTup3 = $validateIRQuery(q.arg[2]);

        let {type: parentType, props: p1} = argTup1;
        if(!isObject(parentType))
            throw new Error("Unable to update field of type: " + prettyPrintType(parentType));
        //let t3 = argTups[2].type;
        if(q.arg[1].op === "vars") {
            throw new Error("Unimplemented");
            /*
            // Old object code. Needs to be completely rewritten.
            let currObj = t3;
            for(let i = e2.arg.length - 1; i >= 0; i--) {
                let keyVar = e2.arg[i];
                let keyVarType = $validateIRQuery(keyVar);
                if(!isInteger(keyVarType) && !isString(keyVarType))
                    throw new Error("Unable to use type: " + prettyPrintType(keyVarType) + " as object key");
                if(i === 0) {
                    return [[keyVarType, currObj], ...t1];
                } else {
                    currObj = [[keyVarType, currObj]];
                }
            }*/
        }
        let {type: keyType, props: p2} = argTup2;
        let {type: valueType, props: p3} = argTup3;
        if(!isInteger(keyType) && !isString(keyType))
            throw new Error("Unable to use type: " + prettyPrintType(keyType) + " as object key");

        let props = p2.union(p3);
        let key = createKey(keyType, "update");
        // If the key and value are not nothing, then the key must not be empty.
        // TODO: Determine if this is true given free variable constraints.
        if(!props.has(props.nothing))
            nonEmptyGuarantees.push(key);
        return {
            type: {
                typeSym: typeSyms.object,
                objKey: key,
                objValue: valueType,
                objParent: parentType
            },
            props: props.difference(nothingSet).union(p1)
        };
    }
    throw new Error("Unable to determine type of query: " + prettyPrint(q));
}

typing.validateIR = (schema, q) => {
    if(schema === undefined)
        return undefined;
    let boundKeys = {};
    let cseMap = {};
    let nonEmptyGuarantees = [];
    let res = validateIRQuery(schema, cseMap, boundKeys, nonEmptyGuarantees, q);
    //console.log(prettyPrintType(res));
    return res;
}