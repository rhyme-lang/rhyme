const { pretty } = require('./prettyprint')
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
createType("unknown"); // Castable to any type. Propagates error if casting is not guaranteed to succeed.

createType("nothing"); // TODO: Add type for front-end, to specify the nothing property.

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

createType("date");

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
typeSyms["function"] = "function"; // (p1, p2, ...) -> r1
typeSyms["tagged_type"] = "tagged_type"; // object with a specialized interface to it used by codegen.
typeSyms["key"] = "key";
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
    if (!t1.typeSym || !t2.typeSym) {
        if (t1 == t2)
            return true;
        return false;
    }
    if (t1.typeSym != t2.typeSym)
        return false;
    switch (t1.typeSym) {
        case "union":
            return sameType(t1.unionSet[0], t2.unionSet[0]) &&
                sameType(t1.unionSet[1], t2.unionSet[1]);
        case "intersect":
            return sameType(t1.intersectSet[0], t2.intersectSet[0]) &&
                sameType(t1.intersectSet[1], t2.intersectSet[1]);
        case "tagged_type":
            return sameType(t1.tagInnertype, t2.tagInnertype) && JSON.stringify(t1.tagData) == JSON.stringify(t2.tagData);
        case "object":
            if (t1.objKey === null)
                return t2.objKey === null;
            if (t2.objKey === null)
                return false;
            return sameType(t1.objKey, t2.objKey) && 
                sameType(t1.objValue, t2.objValue) && 
                sameType(t1.objParent, t2.objParent);
        case "function":
            if (t1.funcParams.length != t2.funcParams.length)
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
    type = unwrapType(type);
    if (type.typeSym == typeSyms.union)
        return isObject(type.unionSet[0]) && isObject(type.unionSet[1]);
    if (isUnknown(type))
        return true;
    if (type.typeSym === typeSyms.object)
        return true;
    return false;
}
typing.isObject = isObject;

let getObjectKeys = (obj) => {
    obj = removeTag(obj);
    if (isUnknown(obj))
        return types.unknown;
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
    if (isUnknown(t1))
        return types.unknown;
    if (isUnknown(t2))
        return types.unknown;
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
    if (isUnknown(t1))
        return t2;
    if (isUnknown(t2))
        return t1;
    if (t1.typeSym === types.never)
        return types.never;
    if (t2.typeSym === types.never)
        return types.never;
    if (isSubtype(t1, t2))
        return t1;
    if (isSubtype(t2, t1))
        return t2;
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
    if (isObject(t1) && isObject(t2)) {
        if (t1.typeSym != typeSyms.object && t2.typeSym != typeSyms.object) {
            throw new Error("Unable to intersect non-object type.");
        }
        let newObj = objBuilder();
        for (let obj = t1; obj.objParent != null; obj = obj.objParent) {
            newObj.add(obj.objKey, obj.objValue);
        }
        for (let obj = t2; obj.objParent != null; obj = obj.objParent) {
            newObj.add(obj.objKey, obj.objValue);
        }
        return newObj.build();
    }
    if (typeDoesntIntersect(t1, t2))
        return types.never;
    // If no intersection can be found, just return one of them. This highlights the worst case where a guarantee can't be made.
    return t1;
}

let createFunction = (result, ...params) => {
    return {
        typeSym: typeSyms.function,
        funcResult: result,
        funcParams: params
    }
}
typing.createFunction = createFunction;

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
typing.createTaggedType = createTaggedType;

/*
 * Objects are constructed of the following:
 * - Parent, Key, Value - Performing a get with a value of type Key, can yield a value of type Value (not guaranteed though).
 *      - Performing a get can yield a set related to that of performing a get on the parent.
 * - Required - Is the object required to have this field defined for every possible value?
 *      - If not, performing a get can yield a Nothing property.
 * - NonEmpty - Is the object guaranteed to have atleast 1 field defined?
 *      - If so, the variable iterating over the domain has atleast 1 possible value.
 *      - Property: If the parent is non-empty, the child is non-empty.
 */
let objBuilder = (root) => {
    let obj = root ?? {
        typeSym: typeSyms["object"], 
        objKey: null,
        objValue: null,
        objParent: null,
        required: false,
        nonEmpty: false,
    };
    let builderObj = {
        add: (key, value) => {
            obj = {
                typeSym: typeSyms["object"], 
                objKey: key,
                objValue: value,
                objParent: obj,
                required: true,
                nonEmpty: obj.nonEmpty,
            };
            return builderObj;
        },
        addOpt: (key, value) => {
            obj = {
                typeSym: typeSyms["object"],
                objKey: key,
                objValue: value,
                objParent: obj,
                required: false,
                nonEmpty: obj.nonEmpty,
            };
            return builderObj;
        },
        nonEmpty: () => {
            obj.nonEmpty = true;
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
        objBuilder().addOpt(keyType, createVec(vecType, keyType, dim - 1, dataType)).build()
    );
}
typing.createVec = createVec;

typing.createVecs = (vecType, keyType, dim, dataTypes) => {
  if (dim == 1)
      return dataTypes.map(dataType => typing.createTaggedType(vecType, {dim: dim},
          typing.objBuilder().addOpt(keyType, dataType).build()));
  return typing.objBuilder().addOpt(keyType, typing.createVec(vecType, keyType, dim - 1, dataTypes)).build().map(ty => typing.createTaggedType(vecType, {dim: dim}, ty));
}

// Essentially a typewise set difference.
let typeSetDiff = (t1, t2) => {
    if(t2.typeSym === typeSyms.union) {
        return typeSetDiff(typeSetDiff(t1, t2.unionSet[0]), t2.unionSet[1]);
    }
    if (t1.typeSym === typeSyms.union) {
        return createUnion(
            typeSetDiff(t1.unionSet[0], t2),
            typeSetDiff(t1.unionSet[0], t2)
        );
    }
    // If every element in t1 is included in t2, removing t2 removes all of t1.
    if (typing.isSubtype(t1, t2)) return types.never;
    // Otherwise, certain elements remain, but no type exists to denote that, hence we return t1 (as a broadened worst case set).
    return t1;
}

let performObjectGet = (obj, key) => {
    switch (obj.typeSym) {
        case typeSyms.unknown:
            return {
                type: types.unknown,
                props: errorSet
            };
        case typeSyms.tagged_type:
            return performObjectGet(removeTag(obj), key);
        case typeSyms.union: {
            let res1 = performObjectGet(obj.unionSet[0], key);
            let res2 = performObjectGet(obj.unionSet[1], key);
            return {
                type: createUnion(res1.type, res2.type),
                props: union(res1.props, res2.props)
            };
        }
        case typeSyms.object:
            if (obj.objValue === null || key.typeSym == typeSyms.never) {
                return {
                    type: types.never,
                    props: nothingSet
                };
            }
            let objKey = obj.objKey;
            let objVal = obj.objValue;
            let objParent = obj.objParent;
            if (!isUnknown(key) && !isUnknown(objKey) && 
                isSubtype(key, objKey) && obj.required) {
                return {
                    type: objVal, props: []
                };
            }
            if (obj.required) {
                // Remove objKey type from key.
                key = typeSetDiff(key, objKey);
            }
            let parentRes = performObjectGet(objParent, key);
            if (typeDoesntIntersect(key, objKey)) {
                return {
                    type: parentRes.type,
                    props: parentRes.props
                };
            }
            return {
                type: createUnion(objVal, parentRes.type),
                props: parentRes.props
            };
        default:
            throw new Error("Unable to perform access on non-object type: " + prettyPrintType(obj));
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
    if (type.typeSym === typeSyms.key)
        type = type.keyType;
    if (expectedType.typeSym === typeSyms.tagged_type)
        expectedType = expectedType.tagInnertype;

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
        for (let nestedObj = expectedType; nestedObj.objKey != null; nestedObj = nestedObj.objParent) {
            let key = nestedObj.objKey;
            let {type: expectedResType, props: expectedResProps} = performObjectGet(expectedType, key);
            let {type: lookupType, props: lookupProps} = performObjectGet(type, key);
            if(!isSubtype(lookupType, expectedResType) || !subset(lookupProps, expectedResProps))
                return false;
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
        default:
            switch (expectedType.typeSym) {
                case typeSyms.union: {
                    let res1 = typeConforms(type, expectedType.unionSet[0]);
                    let res2 = typeConforms(type, expectedType.unionSet[1]);
                    return res1 || res2;
                }
                default:
                    return typeConforms_NonUnion(type, expectedType);
            }
    }
}
let isSubtype = typeConforms;
typing.typeConforms = typeConforms;
typing.isSubtype = typeConforms; // Alias

// Contract: Don't give this function a type that contains objects.
let typeDoesntIntersect = (t1, t2) => {
    if(t1.typeSym === "object" || t1.typeSym === "object")
        throw new Error("Cannot check the type intersection of object types.");
    if(t1 == t2)
        return false;
    switch (t1.typeSym) {
        case typeSyms.never:
            return false;
        case typeSyms.any:
            return false;
        case typeSyms.unknown:
            return false;
        case typeSyms.union: {
            let res1 = typeDoesntIntersect(t1.unionSet[0], t2);
            if(!res1)
                return false;
            return typeDoesntIntersect(t1.unionSet[1], t2);
        }
        default:
            break;
    }
    switch (t2.typeSym) {
        case typeSyms.never:
            return false;
        case typeSyms.any:
            return false;
        case typeSyms.unknown:
            return false;
        case typeSyms.union: {
            let res1 = typeDoesntIntersect(t2.unionSet[0], t1);
            if(!res1)
                return false;
            return typeDoesntIntersect(t2.unionSet[1], t1);
        }
        default:
            break;
    }
    // If we are at this point, neither type is a union, any, or never.
    if(isNumber(t1) && isNumber(t2))
        return false;
    if(isString(t1) && isString(t2)) {
        if(typeof t1 === "string" && typeof t2 === "string")
            return t1 !== t2;
        return false;
    }
    if(isBoolean(t1) && isBoolean(t2))
        return false;
    if (isSubtype(t1, t2) || isSubtype(t2, t1))
        return false;
    return true;
}
typing.typeDoesntIntersect = typeDoesntIntersect;

let isInteger = (type) => {
    type = removeTag(type);
    if (type.typeSym === typeSyms.union)
        // Validate that every value in the union is a integer. Hence overall, it is a integer.
        return isInteger(type.unionSet[0]) && isInteger(type.unionSet[1]);
    //if (type.typeSym === typeSyms.intersect)
    //    return isInteger(type.intersectSet[0]); // Intersections must be able to overlap. Hence, if one is an integer, the entire type is an integer.
    if (type.typeSym === typeSyms.u8 || 
        type.typeSym === typeSyms.u16 || 
        type.typeSym === typeSyms.u32 || 
        type.typeSym === typeSyms.u64 || 
        type.typeSym === typeSyms.i8 || 
        type.typeSym === typeSyms.i16 || 
        type.typeSym === typeSyms.i32 || 
        type.typeSym === typeSyms.i64 ||
        type.typeSym === typeSyms.never)
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
    //if (type.typeSym === typeSyms.intersect)
    //    return isNumber(type.intersectSet[0]);
    if (type.typeSym === typeSyms.key)
        return isNumber(type.keyType);
    if (type.typeSym === typeSyms.f32 || type.typeSym === typeSyms.f64)
        return true;
    return false;
}
typing.isNumber = isNumber;

let isKey = (type) => {
    type = removeTag(type);
    if (type.typeSym == typeSyms.union)
        return isKey(type.unionSet[0]) && isKey(type.unionSet[1]);
    //if (type.typeSym == typeSyms.intersect)
    //    return isKey(type.intersectSet[0]);
    if (type.typeSym === typeSyms.dynkey)
        return isKey(type.keySupertype);
    return isUnknown(type) || isNumber(type) || isString(type) || type.typeSym == typeSyms.date;
}
typing.isKey = isKey;

let isUnknown = (type) => {
    type = removeTag(type);
    if (type.typeSym == typeSyms.key)
        return isUnknown(type.keyType);
    if (type.typeSym == typeSyms.unknown)
        return true;
    return false;
};
typing.isUnknown = isUnknown;

let isBoolean = (type) => {
    type = removeTag(type);
    if (type.typeSym === typeSyms.union)
        return isBoolean(type.unionSet[0]) && isBoolean(type.unionSet[1]);
    //if (type.typeSym === typeSyms.intersect)
    //    return isBoolean(type.intersectSet[0]);
    if (type.typeSym === typeSyms.key)
        return isBoolean(type.keyType);
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
    if (isUnknown(type)) {
        return types.f64;
    }
    if (!isNumber(type))
        throw new Error("Unable to generalize non-number type: " + prettyPrintType(type));
    switch (type.typeSym) {
        case typeSyms.union:
            return createUnion(
                generalizeNumber(type.unionSet[0]),
                generalizeNumber(type.unionSet[1])
            );
        case typeSyms.key:
            return generalizeNumber(type.keyType);
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
    if (type.typeSym === typeSyms.key)
        return isString(type.keyType);
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
    //if (schema.typeSym === typeSyms.intersect)
    //    return "(" + Array.from(schema.intersectSet).map(type => prettyPrintType(type)).join(" & ") + ")";
    if (schema.typeSym === typeSyms.function)
        return "(" + schema.funcParams.map(type => prettyPrintType(type)).join(", ") + ") -> " + prettyPrintType(schema.funcResult);
    if (schema.typeSym === typeSyms.key)
        return `<${prettyPrintType(schema.keyType)}>`;
    if (schema.typeSym === typeSyms.tagged_type)
        return schema.tag +":"+prettyPrintType(schema.tagInnertype);
    if (isObject(schema)) {
        if (schema.objKey === null)
            return "{}";
        else
            return `${prettyPrintType(schema.objParent)}{${prettyPrintType(schema.objKey)}: ${prettyPrintType(schema.objValue)}}${schema.nonEmpty ? "!" : ""}`;
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

let symIndex = 0;
let freshSym = (pref) => pref + (symIndex++);

let validateIRQuery = (schema, cseMap, varMap, nonEmptyGuarantees, q) => {
    if (q.schema)
        return q.schema;
    /*let stringify = JSON.stringify(q);
    if (cseMap[stringify]) {
        q.schema = cseMap[stringify];
        if (q.arg)
            q.arg.map(arg => validateIRQuery(schema, cseMap, varMap, nonEmptyGuarantees, arg));
        return cseMap[stringify];
    }*/

    let res = _validateIRQuery(schema, cseMap, varMap, nonEmptyGuarantees, q);
    q.schema = res;
    //cseMap[stringify] = res;
    return res;
};

let bndVarsDefined = (varMap, bnd) => {
    for(let bndVar of bnd) {
        if(varMap[bndVar].exprs.length > 1)
            return false;
        let expr = varMap[bndVar].exprs[0];
        if (!expr.nonEmpty)
            return false;
    }
    return true;
}

let _validateIRQuery = (schema, cseMap, varMap, nonEmptyGuarantees, q) => {
    let $validateIRQuery = (newQ) => {
        return validateIRQuery(schema, cseMap, varMap, nonEmptyGuarantees, newQ);
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
        return {type: q.inputSchema, props: argTups[0].props};
    } else if (q.key === "const") {
        if (typeof q.op === "object" && Object.keys(q.op).length === 0)
            return intoTup(objBuilder().build());
        if (typeof q.op === "number") {
            if (q.op < 0) {
                if (q.op >= -32767)
                    return intoTup(types.i16);
                if (q.op >= -2147483647)
                    return intoTup(types.i32);
                return intoTup(types.i64);
            }
            // TODO: What should the default size of constants be? Current implementation is C specification.
            if (q.op < 32768)
                return intoTup(types.i16);
            if (q.op < 2147483648)
                return intoTup(types.i32);
            return intoTup(types.i64);
        }
        if (typeof q.op === "string")
            return intoTup(q.op);
        if (typeof q.op === "boolean")
            return intoTup(types.boolean); // Should "false" be a boolean?
        if (q.op === undefined) {
            // TODO: Undefined is a boolean? Specifically, false?
            return {type: types.never, props: nothingSet};
        }
        throw new Error("Unknown const: " + q.op)
    } else if (q.key === "var") {
        
        if(varMap[q.op] === undefined)
            throw new Error(`Unable to find definition for variable ${q.op}`);
        return {
            type: {
                typeSym: typeSyms.key,
                keyType: varMap[q.op].varType,
                keyName: q.op
            },
            props: []
        };

    } else if (q.key === "vars") {
        
        throw new Error("Vars type unable to be calculated.");
        return $validateIRQuery(q.arg[0]);

    } else if (q.key === "get") {
        
        let objTup = $validateIRQuery(q.arg[0]);
        let objType = objTup.type;

        let keyTup = $validateIRQuery(q.arg[1]);
        let keyType = keyTup.type;
        
        if (isUnknown(objType)) {
            return {
                type: types.unknown,
                props: union(objTup.props, union(keyTup.props, union(nothingSet, errorSet)))
            }
        }
        if (!isObject(objType)) {
            throw new Error("Unable to perform get operation on non-object type: " + prettyPrintType(objType) + "\nReceived from query: " + pretty(q.arg[0]));
        }

        let resTup = performObjectGet(objType, keyType);
        let extraProps = resTup.props;

        // TODO: Use better domain check.
        if (keyType.typeSym === typeSyms.key) {
            let valid = false;
            let expr = q.arg[0];
            // If iterating over any subset of the domain of the object, it is guaranteed to produce a result.
            while(q.typeSym == "update") {
                if(!varMap[keyType.keyName].exprs.includes(expr)) {
                    valid = true;
                    break;
                }
                expr = expr.arg[0];
            }
            if(!varMap[keyType.keyName].exprs.includes(expr)) {
                valid = true;
            }
            if (valid)
                extraProps = diff(extraProps, nothingSet);
        }
        // Unknown type as key cannot error, only at worst produce nothing. Hence no error type is introduced if unknown.
        return {
            type: resTup.type,
            props: union(objTup.props, union(keyTup.props, extraProps))
        };
    } else if (q.key === "pure") {
        let argTups = q.arg.map($validateIRQuery);

        if (q.op == "apply") {
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1)) {
                let exprProps = argTups.reduce((acc, curr) => union(acc, curr.props), errorSet);
                return {
                    type: types.unknown,
                    props: exprProps
                };
            }
            if (t1.typeSym != typeSyms.function)
                throw new Error(`Unable to apply a value to a non-function value (type ${prettyPrintType(t1)})\nApplying to non-function: ${pretty(q.arg[0])}\nWith argument: ${pretty(q.arg[1])}`)
            if (t1.funcParams.length + 1 != argTups.length)
                throw new Error(`Unable to apply function "${pretty(q.arg[0])}". Number of args do not align.`);
            let exprProps = p1;
            for (let i = 0; i < argTups.length - 1; i++) {
                let {type, props: argProps} = argTups[i + 1];
                let expType = t1.funcParams[i];
                if (!isUnknown(type) && !isSubtype(type, expType)) {
                    throw new Error(`Unable to apply function "${pretty(q.arg[0])}". Argument ${i + 1} does not align.\nExpected: ${prettyPrintType(expType)}\nReceived: ${prettyPrintType(type)}.`);
                }
                if (isUnknown(type))
                    exprProps = union(exprProps, errorSet);
                exprProps = union(exprProps, argProps);
            }
            // All inputs conform.
            return {type: t1.funcResult, props: exprProps};
        } else if (q.op == "flatten") {
            if (q.arg.length == 0) {
                return {
                    type: objBuilder().build(), 
                    props: []
                };
            }
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1)) {
                let exprProps = argTups.reduce((acc, curr) => union(acc, curr.props), union(p1, errorSet));
                return {
                    type: types.unknown,
                    props: exprProps
                };
            }
            
            let tup1 = $validateIRQuery(q.arg[0]);
            let innerTups = performObjectGet(tup1.type, getObjectKeys(tup1.type));
            // If argument always returns atleast one value, add a non-empty guarantee.
            // TODO: Fix for flatten
            // if (!innerTups.props.includes(props.nothing))
            //    nonEmptyGuarantees.push(key);
            return {
                type: objBuilder()
                    .addOpt(types.u32, innerTups.type).build(), 
                props: diff(innerTups.props,nothingSet)
            };

        } else if (q.op == "join") {
            return {type: types.unknown, props: []};
            let argTypes = argTups.map((tup) => {
                if (tup.type.typeSym != typeSyms.unknown && !isObject(tup.type)) {
                    throw new Error("Unable to perform join operation on non-object: " + prettyPrintType(tup));
                }
                return tup.type
            });
            if (argTypes.includes(types.unknown)) {
                return {
                    type: types.unknown,
                    props: argTups.reduce((acc, curr) => union(acc, curr.props), errorSet)
                }
            }
            let joinRes = argTypes.reverse().reduce((acc, curr) => {
                let obj = curr;
                while (obj.objParent != null) {
                    acc = {
                        typeSym: typeSyms.object,
                        objKey: obj.objKey,
                        objValue: obj.objKey,
                        objParent: acc,
                    };
                    obj = obj.objParent;
                }
                return acc;
            }, objBuilder().build());
            return intoTup(joinRes);

        } else if (q.op.startsWith("convert_")) {

            return q.schema;

        } else if (q.op === "equal" || q.op === "and" || q.op === "notEqual" || q.op === "fdiv" || q.op == "concat" ||
            q.op === "plus" || q.op === "minus" || q.op === "times" || q.op === "div" || q.op === "mod" ||
            q.op === "lessThan" || q.op === "greaterThan" || q.op === "lessThanOrEqual" || q.op === "greaterThanOrEqual" ||
            q.op == "andAlso" || q.op == "orElse") {
            // If q is a binary operation:
            // TODO: Figure out difference between fdiv and div.
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];
            if (q.op == "concat") {
                if ((isUnknown(t1) || isString(t1)) && (isUnknown(t2) || isString(t2)))
                    return {
                        type: types.string,
                        props: union(p1, p2)
                    };
                throw new Error(`Unable to concatenate non-strings of type ${prettyPrintType(t1)} and ${prettyPrintType(t2)}. ` + pretty(q.arg[0]) + " and " + pretty(q.arg[1]));
            } else if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "div" || q.op == "mod") {
                if ((!isUnknown(t1) && !isNumber(t1)) || (!isUnknown(t2) && !isNumber(t2))) {
                    throw new Error(`Unable to perform plus on non-numbers of type ${prettyPrintType(t1)} and ${prettyPrintType(t2)}. ` + pretty(q.arg[0]) + " and " + pretty(q.arg[1]));
                }
                let resType = generalizeNumber(createUnion(t1, t2));
                return {
                    type: resType,
                    props: union(p1,p2)
                };
            } else if (q.op == "fdiv") {
                // TODO: validate types for fdiv
                return {type: types.f64, props: union(p1,p2)};
            } else if (q.op === "equal" || q.op === "notEqual" ||
                q.op === "lessThan" || q.op === "greaterThan" ||
                q.op === "lessThanOrEqual" || q.op === "greaterThanOrEqual") {
                // TODO: validate types for comparison and logical ops
                return {type: types.boolean, props: union(p1,union(p2, nothingSet))};
            } else if (q.op == "and") {
                // TODO: validate types for and
                return {type: t2, props: union(p1, p2)};
            } else if (q.op == "andAlso") {
                // TODO: validate types for and
                return {type: t2, props: union(p1, p2)};
            } else if (q.op == "orElse") {
                // TODO: validate types for orElse
                let exprProps = [];
                if(p1.includes(props.nothing) && p2.includes(props.nothing))
                    exprProps.push(props.nothing)
                if(p1.includes(props.error) || p2.includes(props.error))
                    exprProps.push(props.error)
                return {type: createUnion(t1, t2), props: exprProps};
            }
            throw new Error("Pure operation not implemented: " + q.op);
        } else if (q.op == "combine") {
            return argTups[0];
        } else if (q.op === "mkTuple") {
            let builder = objBuilder();
            let exprProps = [];
            for (let i = 0; i < q.arg.length; i += 2) {
                let argTup1 = $validateIRQuery(q.arg[i]);
                let argTup2 = $validateIRQuery(q.arg[i + 1]);

                builder.add(argTup1.type, argTup2.type);
                exprProps = union(union(argTup1.props, argTup2.props), exprProps);
            }
            return {
                type: builder.build(),
                props: exprProps
            };
        } else if (q.op == "singleton") {
            // TODO Figure out what singleton does.
            let {type: t1, props: p1} = argTups[0];
            return {
                type: objBuilder().addOpt(t1, types.boolean).build(),
                props: p1
            };
        } else if (q.op == "ifElse") {
            // Argument simply checks for existence of value. Hence, the value itself isn't used.
            // Aswell, the nothing property shouldn't be propagated.
            let {type: _, props: p1} = argTups[0];

            let exprProps = [];
            if(p1.includes(props.error))
                exprProps = errorSet;
            let {type: t2, props: p2} = argTups[1];
            let {type: t3, props: p3} = argTups[2];
            return {type: createUnion(t2, t3), props: union(union(p2, p3), exprProps)};
        } else if (q.op == "sort") {
            return argTups[argTups.length - 1];
        } else if (q.op == "year") {
            // arg has to be of type date
            let {type: t1, props: p1} = argTups[0];
            if (t1.typeSym != typeSyms.date)
                throw new Error("Unable to perform year operation on non-date type: " + prettyPrintType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
            return argTups[0]
        } else if (q.op == "substr") {
            // arg has to be of type date
            let {type: t1, props: p1} = argTups[0];
            if (!isString(t1))
                throw new Error("Unable to perform substr operation on non-string type: " + prettyPrintType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
            return {
                type: types.string,
                props: p1
            }
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key === "hint") {

        return {type: types.never, props: []};

    } else if (q.key === "mkset") {
        let argTup = $validateIRQuery(q.arg[0]);

        let exprProps = argTup.props;

        let builder = objBuilder()
            .addOpt(argTup.type, types.boolean);

        if (bndVarsDefined(varMap, q.bnd)) {
            if (!exprProps.includes(props.nothing))
                builder = builder.nonEmpty();
        }

        // If argument always returns atleast one value, add a non-empty guarantee.
        return {
            type: builder.build(),
            props: diff(exprProps, nothingSet)
        }

    } else if (q.key === "prefix") {
        let argTup = $validateIRQuery(q.arg[0]);
        let argType = argTup.type;

        if (q.op === "sum" || q.op === "product") {
            // Check if each arg is a number.
            if (!isUnknown(argType) && !isNumber(argType))
                throw new Error(`Unable to ${q.op} non-number values currently. Got: ${prettyPrintType(argType)}`);
            if (argType == types.unknown)
                argType = types.f64
            return {type: argType, props: diff(argTup.props, nothingSet)};
        } else if (q.op === "min" || q.op === "max") {
            if (!isUnknown(argType) && !isNumber(argType))
                throw new Error("Unable to union non-number values currently.");

            return  {
                type: objBuilder()
                    .addOpt(types.u32, argType)
                    .build(),
                props: argTup.props
            };
        }

    } else if (q.key === "stateful") {

        let argTups = q.arg.map($validateIRQuery);

        let argTup = argTups[0];
        let argType = argTup.type;
        let exprProps = argTup.props;

        if (!bndVarsDefined(varMap, q.bnd))
            exprProps = union(exprProps, nothingSet);
        
        if (q.mode !== "maybe" && q.op !== "all" && q.op !== "any")
            exprProps = diff(argTup.props, nothingSet);

        if (q.op === "sum" || q.op === "product") {
            // Check if each arg is a number.
            if (!isUnknown(argType) && !isNumber(argType))
                throw new Error(`Unable to ${q.op} non-number values currently. Got: ${prettyPrintType(argType)}`);
            if (isUnknown(argType))
                argType = types.f64
            return {type: argType, props: exprProps};
        } else if (q.op === "min" || q.op === "max") {
            if (!isUnknown(argType) && !isNumber(argType))
                throw new Error("Unable to union non-number values currently.");

            return  {type: argType, props: exprProps};
        } else if (q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.u32, props: exprProps};
        } else if (q.op === "all") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.boolean, props: exprProps};
        } else if (q.op === "single" || q.op === "first" || q.op === "last") {
            // Propagate both type and properties.
            return argTup;
        } else if (q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.

            let builder = objBuilder();
            builder = builder.addOpt(types.u32, argType);

            // If there is atleast one value for bnd variables, and if the argument is guaranteed to return something, atleast one item is accumulated.
            if (bndVarsDefined(varMap, q.bnd) && !argTup.props.includes(props.nothing))
                builder = builder.nonEmpty();
            
            // If argument always returns atleast one value, add a non-empty guarantee.
            return {
                type: builder.build(),
                props: diff(argTup.props, nothingSet)
            };
        } else if (q.op === "print") {
            return {type: types.never, props: []};
        } else if (q.op == "mkset") {

            let argTup = $validateIRQuery(q.arg[0]);

            let keyType = argTup.type;
            let key = keyType;

            let builder = objBuilder()
                .add(key, types.boolean);

            // If argument always returns atleast one value, add a non-empty guarantee.
            if (bndVarsDefined(varMap, q.bnd) && !argTup.props.includes(props.nothing))
                builder = builder.nonEmpty();

            return {
                type: builder.build(),
                props: diff(argTup.props,nothingSet)
            }
        }

        throw new Error("Unimplemented stateful expression " + q.op);

    } else if (q.key === "update") {
        if (q.arg[3]) $validateIRQuery(q.arg[3]);
        let parentTup = $validateIRQuery(q.arg[0]);
        let valueTup = $validateIRQuery(q.arg[2]);

        let {type: parentType, props: p1} = parentTup;
        if (!isUnknown(parentType) && !isObject(parentType))
            throw new Error("Unable to update field of type: " + prettyPrintType(parentType));
        
        let keyExpr = q.arg[1];
        let keyTup;
        if (keyExpr.op === "vars") {
            for (let argI = keyExpr.arg.length - 1; argI > 0; argI--) {
                let innerKeyTup = $validateIRQuery(keyExpr.arg[argI]);
                valueTup = {
                    type: {
                        typeSym: typeSyms.object,
                        objKey: innerKeyTup.type,
                        objValue: valueTup.type,
                        objParent: objBuilder().build(),
                        required: false,
                        nonEmpty: false,
                    },
                    props: union(diff(innerKeyTup.props, nothingSet), valueTup.props)
                };
            }
            keyTup = $validateIRQuery(keyExpr.arg[0]);
        } else if (keyExpr.op == "placeholder") {
            keyTup = $validateIRQuery(keyExpr);
        } else {
            keyTup = $validateIRQuery(keyExpr);
        }

        let {type: keyType, props: p2} = keyTup;
        keyType = unwrapType(keyType);
        let {type: valueType, props: p3} = valueTup;

        if (!isUnknown(keyType) && !isKey(keyType))
            throw new Error("Unable to use type: " + prettyPrintType(keyType) + " as object key");

        let exprProps = [];
        if(p2.includes(props.error))
            exprProps = union(exprProps, errorSet);
        if(p3.includes(props.error))
            exprProps = union(exprProps, errorSet);

        let nonEmpty = false;
        let required = false;
        // Given the bound variables have definitive values (not nothing)
        // And each key and value have a value (not nothing).
        if (bndVarsDefined(varMap, q.bnd) && !p2.includes(props.nothing) && !p3.includes(props.nothing)) {
            // Then the resulting updated object is non-empty.
            nonEmpty = true;
            if(typeof keyType === "string") {
                // If key is a string, then the value that is defined is clear: The specific string that it is
                // {total: u8}, when non-empty, must have "total" defined, obviously.
                required = true;
            }
        }
        
        return {
            type: {
                typeSym: typeSyms.object,
                objKey: keyType,
                objValue: valueType,
                objParent: parentType,
                required: required,
                nonEmpty: nonEmpty
            },
            props: union(exprProps, p1)
        };
    }
    throw new Error("Unable to determine type of query: " + pretty(q));
}

let stringStream = (string, holes) => {
    let index = 0;
    let holeIndex = 0;
    let consumeWhitespace = () => {
        while (
            string.charAt(index) == " " ||
            string.charAt(index) == "\n" ||
            string.charAt(index) == "\t" ||
            string.charAt(index) == "\r"
        ) index += 1;
    }
    consumeWhitespace();
    return {
        string: () => string,
        index: () => index,
        expect: (str) => {
            if (string.substring(index).startsWith(str)) {
                index += str.length;
                consumeWhitespace();
                return;
            }
            throw new Error(`Error when parsing type: Unable to parse type. Expected: ${str} at "${string.substring(index)}"`);
        },
        peek: () => {
            return string.charAt(index);
        },
        substring: () => {
            return string.substring(index);
        },
        consumeHole: () => {
            holeIndex += 1;
            return holes[holeIndex - 1];
        },
        consume: (i) => {
            if (index >= string.length)
                throw new Error(`Error when parsing type: Unable to consume character at end of string.`);
            index += i;
            consumeWhitespace();
        }
    }
}

// Note: Usage of this will result in certain value types (specific strings) to be converted to other unrelated types.
let parseTypeString_Atom = (stream, vars, objCtx) => {
    if (stream.peek() === "\0") {
        stream.expect('\0');
        return typing.parseType(stream.consumeHole());
    }
    if (stream.peek() == "(") {
        stream.expect("(");
        let argArr = [];
        if (stream.peek() == ")") {
            stream.expect(")");
        } else {
            argArr.push(parseTypeString_Infix(stream, vars));
            while (stream.peek() == ",") {
                stream.expect(",");
                argArr.push(parseTypeString_Infix(stream, vars));
            }
            stream.expect(")")
        }
        stream.expect("=>");
        let resType = parseTypeString_Infix(stream, vars);
        return typing.createFunction(resType, ...argArr);
    }
    
    if (stream.peek() == "{") {

        stream.expect("{");

        let builder = typing.objBuilder(objCtx);
            
        if (stream.peek() != "}") {
            let key = parseTypeString_Infix(stream, vars);
            let opt = false;
            if(stream.peek() == "?") {
                stream.expect("?");
                opt = true;
            }
            stream.expect(":");
            let val = parseTypeString_Infix(stream, vars);
            if (opt)
                builder.addOpt(key, val)
            else
                builder.add(key, val)
            while (stream.peek() == ",") {
                stream.expect(",");
                let key = parseTypeString_Infix(stream, vars);
                let opt = false;
                if(stream.peek() == "?") {
                    stream.expect("?");
                    opt = true;
                }
                stream.expect(":");
                let val = parseTypeString_Infix(stream, vars);
                if (opt)
                    builder.addOpt(key, val)
                else
                    builder.add(key, val)
            }
        }
        stream.expect("}")
        if(stream.peek() == "!") {
            stream.expect("!");
            builder = builder.nonEmpty();
        }
        return builder.build();
    }
    if (stream.peek() == "[") {
        stream.expect("[");
        let resType = parseTypeString_Infix(stream, vars);
        stream.expect("]");
        let obj = typing.objBuilder()
            .addOpt(types.u32, resType);
        if(stream.peek() == "!") {
            stream.expect("!");
            obj = obj.nonEmpty();
        }
        return obj.build();
    }
    if (stream.peek() == "\"") {
        stream.expect("\"");
        let str = "";
        while (stream.peek() != "\"") {
            str += stream.peek();
            stream.consume(1);
        }
        stream.expect("\"");
        return str;
    }
    let match = stream.substring().match(/^([a-zA-Z0-9\-_]+)($|[?|&\s,\:\[\]\{\}\(\)=])/);
    if (!match)
        throw new Error(`Error when parsing type: Unknown type at ${stream.substring()}`);
    stream.consume(match[1].length);

    if (Object.values(types).map((obj) => obj.typeSym).includes(match[1]))
        return types[match[1]];
    return match[1];
}

let parseTypeString_Infix = (stream, vars) => {
    let exp = parseTypeString_Atom(stream, vars);
    while (stream.peek() == "|" || stream.peek() == "&") {
        let char = stream.peek();
        stream.expect(char);
        let objCtx;
        if (char == "&")
            objCtx = exp;
        let nextExp = parseTypeString_Atom(stream, vars, objCtx);
        if (char == "|")
            exp = typing.createUnion(exp, nextExp);
        if (char == "&")
            exp = nextExp;
    }
    return exp;
}

// Used for converting human-readable types into their proper format.
typing.parseType = (schema, ...typeHoles) => {
    if (schema === undefined)
        return undefined;
    if (Array.isArray(schema)) {
        for (let i = 0; i < schema.length; i++) {
            if (schema[i].includes("\0")) {
                throw new Error("Unable to include '\\0' character inside type parsing.");
            }
        }
        schema = [...schema].join("\0");
        let resType = parseTypeString_Infix(stringStream(schema, typeHoles), {});
        return resType;
    }
    if (typeof schema === "string") {
        if (schema.includes("\0"))
            throw new Error("Unable to include '\\0' character inside type parsing.");
        let resType = parseTypeString_Infix(stringStream(schema, []), {});
        return resType;
    }
    if (typeof schema !== "object")
        throw new Error("Unknown type: " + schema);
    switch (schema.typeSym) {
        case undefined:
            if (Object.keys(schema).length == 0) {
                return objBuilder().build();
            }
            let key = Object.keys(schema)[Object.keys(schema).length - 1];
            // Create new schema without key, without mutating the existing object.
            let {[key]: _, ...newSchema} = schema;
            // If keyval is used, extract the pair.
            let keyType = typing.parseType(key);
            let valueType = typing.parseType(schema[key]);
            let required = true;
            if (valueType.typeSym == typeSyms.keyval) {
                keyType = typing.parseType(valueType.keyvalKey);
                valueType = typing.parseType(valueType.keyvalValue);
            }
            // If not a string, then assume not all values are filled in the object keys.
            if (typeof keyType !== "string")
                required = false;
            // Recurse until the base object is reached, then construct object.
            let parent = typing.parseType(newSchema);
            return {
                typeSym: typeSyms.object,
                objKey: keyType,
                objValue: valueType,
                objParent: parent,
                required: required,
                nonEmpty: false
            };
        case typeSyms.union:
            schema.unionSet[0] = typing.parseType(schema.unionSet[0]);
            schema.unionSet[1] = typing.parseType(schema.unionSet[1]);
            return schema;
        //case typeSyms.intersect:
        //    schema.intersectSet[0] = typing.parseType(schema.intersectSet[0]);
        //    schema.intersectSet[1] = typing.parseType(schema.intersectSet[1]);
        //    return schema;
        case typeSyms.key:
            schema.keyType = typing.parseType(schema.keyType)
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

let unwrapType = (type) => {
    switch (type.typeSym) {
        case typeSyms.tagged_type:
            return unwrapType(type.tagInnertype);
        case typeSyms.key:
            return unwrapType(type.keyType);
        case typeSyms.union:
            return createUnion(
                unwrapType(type.unionSet[0]),
                unwrapType(type.unionSet[1])
            )
    }
    return type;
}

let convertQuery = (q, type) => {
    // Tagged types and key types don't need conversion.
    // Just unwrap them.
    let curType = unwrapType(q.schema.type);
    // Check if type is equal.
    if (curType == type)
        return q;
    // For Objects and functions:
    // - No conversion is necessary or can be done. Hence, this function should never be ran on them.

    // All leafs in the union-interseciton tree must then be primitive number/string types.
    // This leaves that it is:
    // 1. A different sub/supertype (u8 vs u16).
    // 2. A different type. (string vs u16).
    // 3. A union (of non-subtypes)
    // 4. A intersection (of non-subtypes)

    let convert = () => {
        // Remove redundant conversions.
        while (q.key == "pure" && (q.op == "convert_string" || 
            q.op.startsWith("convert_") && Object.keys(types).includes(q.op.substring("convert_".length)) &&
            // If type is being narrowed, no need to narrow it twice.
            // NOTE: Cannot do the same when narrowed and then widened, hence the subtype check.
            typing.isSubtype(type, types[q.op.substring("convert_".length)])
        )) {
            q = q.arg[0];
        }
        return {
            ...q,
            key: "pure",
            op: "convert_" + type.typeSym,
            arg: [q],
            schema: {type: type, props: q.schema.props}
        };
    };

    if (curType.typeSym === typeSyms.union) // || curType.typeSym === typeSyms.intersect)
        // If not guaranteed by now, then it has to be converted to be guaranteed.
        return convert();
    if (type.typeSym === typeSyms.u64 || type.typeSym === typeSyms.i64)
        // u64 and i64 must be converted because they use BigInt type in JS.
        // TODO: Determine how to unify JS and C conversion, since this might not be necessary in C.
        // Edit: It doesn't matter because C just uses casting (and will optimize anyway).
        return convert();
    if (typing.isSubtype(curType, type)) {
        return q;
    }
    return convert();
}

let convertAST = (schema, q, completedMap, dontConvertVar = false) => {
    
    let $convertAST = (q, dontConvertVar = false) => {
        //if (completedMap[JSON.stringify(q)])
        //    return completedMap[JSON.stringify(q)];
        let res = convertAST(schema, q, completedMap, dontConvertVar)
        //completedMap[JSON.stringify(q)] = res;
        return res;
    };

    if (q.key == "input") {
        return q;
    } else if (q.key === "loadInput") {
        return q;
    } else if (q.key == "const") {
        return q;
    } else if (q.key == "var") {
        // TODO: Number | String union type is (perhaps) impossible to handle as key.
        // Atleast it is without a check that converts it to a number iff matches \-?[1-9][0-9]*(\.[1-9][0-9]*)?\
        if (isNumber(q.schema.type) && !dontConvertVar) {
            // Convert to lcd num type.
            let resType = generalizeNumber(q.schema.type);
            return {
                ...q,
                key: "pure",
                op: "convert_" + resType.typeSym,
                arg: [q],
            };
        } else {
            // Default to string type, so no conversion is needed.
            // Note: if unknown and not proper type, then undefined behavior will happen.
            return q;
        }
    } else if (q.key == "vars") {
        q.arg = q.arg.map($convertAST);
        return q;
    } else if (q.key === "get") {
        q.arg = q.arg.map((q) => $convertAST(q, true));
        // Assuming the object is well-formed, the result doesn't need converted.
        return q;
    } else if (q.key == "hint") {
        throw new Error("Unknown.");
    } else if (q.key == "pure") {
        
        if (q.op == "apply" || q.op == "flatten" || q.op == "join" || q.op == "vars") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op.startsWith("convert_")) {
            return q;
        } else if (q.op === "equal" || q.op === "lessThan" || q.op === "lessThanOrEqual" || q.op === "greaterThan" || q.op == "concat" ||
            q.op === "greaterThanOrEqual" || q.op === "and" || q.op === "andAlso" || q.op === "notEqual" || q.op === "orElse" || q.op === "fdiv" || 
            q.op === "plus" || q.op === "minus" || q.op === "times" || q.op === "div" || q.op === "mod") {
            
            if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "div" || q.op == "mod") {
                
                let resType = generalizeNumber(createUnion(q.arg[0].schema.type, q.arg[1].schema.type));
                q.arg = q.arg.map((q) => convertQuery($convertAST(q), resType));
                
                return {
                    ...q,
                    key: "pure",
                    op: "convert_" + resType.typeSym,
                    arg: [q],
                };

            } else if (q.op == "concat") {
                return q;
                /*
                if (q.op == "concat") {
                    let resType = types.string;
                    q.arg = q.arg.map((q) => convertQuery($convertAST(q), resType));
                    return {
                        ...q,
                        key: "pure",
                        op: "convert_" + resType.typeSym,
                        arg: [q],
                    };
                }*/
            } else if (q.op == "fdiv") {
                // Convert args to f64 and do float division.
                q.arg = q.arg.map((q) => convertQuery($convertAST(q), types.f64));
                return q;
            } else if (q.op == "equal" || q.op == "notEqual" || q.op === "lessThan" || q.op === "lessThanOrEqual" ||
                q.op === "greaterThan" || q.op === "greaterThanOrEqual") {
                let argSchema1 = unwrapType(q.arg[0].schema.type);
                let argSchema2 = unwrapType(q.arg[1].schema.type);
                // TODO: i64 | u64 union figure out type at runtime?????
                if (isSubtype(types.u64, argSchema1) || isSubtype(types.i64, argSchema1) || isSubtype(types.u64, argSchema2) || isSubtype(types.i64, argSchema2)) {
                    let resType = generalizeNumber(createUnion(argSchema1, argSchema2));
                    q.arg = q.arg.map((q) => convertQuery($convertAST(q), resType));
                    return q;
                }
                q.arg = q.arg.map($convertAST);
                return q;
            } else if (q.op == "and") {
                return q;
            } else if (q.op == "andAlso") {
                return q;
            } else if (q.op == "orElse") {
              return q;
            }
            throw new Error("Pure operation not implemented: " + q.op);
        } else if (q.op == "mkTuple") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op == "combine") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "ifElse") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "sort") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "year") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "substr") {
            q.arg = q.arg.map($convertAST);
            return q;
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key == "stateful") {
        q.arg = q.arg.map($convertAST);
        if (q.op == "sum" || q.op == "product") {
            return {
                ...q,
                key: "pure",
                op: "convert_" + q.schema.type.typeSym,
                arg: [q],
            };
        }
        return q;
    } else if (q.key == "prefix") {
        q.arg = q.arg.map($convertAST);
        return q;
    } else if (q.key == "mkset") {
        q.arg = q.arg.map($convertAST);
        return q;
    } else if (q.key == "update") {
        q.arg = q.arg.map($convertAST);
        return q;
    }
    throw new Error("Unknown key: " + q.key);
}

/*
 * Traverse an expression to find every variable inside of it.
 * & Cache the result to make future lookups quicker.
 */
let findDependencies = (q) => {
    let deps = $findDependencies(q);
    q.varDeps = deps;
    return deps;
}

let $findDependencies = (q) => {
    if(q.varDeps)
        return q.varDeps;
    if(q.key == "var")
        return [q.op];
    if(q.arg)
        return q.arg.reduce((prev, curr) => union(findDependencies(curr), prev), []);
    return [];
}

/*
 * Fill varMap with every variable, and what other variables it depends on.
 * Traverse the entire AST to find these dependencies before trying to determine any types.
 */
let findVariables = (q, varMap) => {
    if (q.arg)
        q.arg.map(arg => findVariables(arg, varMap))
    // NOTE: Because args are done before the overall query,
    // it will be sorted such that dependencies are first in a types/exprs list.
    if (q.key != "get")
        return;
    if (q.arg[1].key != "var")
        return;
    let name = q.arg[1].op;
    let deps = findDependencies(q.arg[0]); //q.arg[0].vars;
    if (Object.keys(varMap).includes(name)) {
        varMap[name].deps = union(deps, varMap[name].deps);
        varMap[name].exprs.push(q);
    } else {
        varMap[name] = {
            var: name,
            deps: deps,
            exprs: [q],
        }
    }
};

/*
 * Given a variable to infer the type of, infer the type of all of its dependencies.
 * Then, using those, infer the type of itself.
 * - Note: Circular dependencies exist. For these cases, simply return "unknown" when a loop is detected.
 *  - TODO: Do a fixpoint calculation to determine what the types converge to
 */
let _inferVarTypes = (varName, varMap, foundList, pathList, schema, cseMap, nonEmptyGuarantees) => {
    if (foundList.includes(varName))
        return;
    if (pathList.includes(varName)) {
        // Loop has been detected, default to unknown. (Later iterations will refine the type, though perhaps not as much as is desired.)
        varMap[varName].varType = types.unknown;
        foundList.push(varName);
        return;
    }
    pathList.push(varName);

    // Infer the type of all dependencies, in order to be able to determine the type of the variable.
    // Without these, validating an expression would return a type error, for the necessary variables being undefined.
    let deps = varMap[varName].deps;
    let unfoundDeps;
    while ((unfoundDeps = deps.filter(dep => !foundList.includes(dep))).length > 0) {
        let nextDep = unfoundDeps[0];
        _inferVarTypes(nextDep, varMap, foundList, pathList, schema, cseMap, nonEmptyGuarantees);
    }
    // Remove current variable from pathList. No longer need to find circular dependencies.
    pathList.splice(pathList.length - 1, 1);

    let varType = types.unknown;
    for (let i = 0; i < varMap[varName].exprs.length; i++) {
        let query = varMap[varName].exprs[i];
        let objTup = validateIRQuery(schema, cseMap, varMap, nonEmptyGuarantees, query.arg[0]);
        let keyType = getObjectKeys(objTup.type);

        varType = createIntersection(varType, keyType);
    }
    varMap[varName].varType = varType;
    foundList.push(varName);
}

/*
 * Pop off every variable out of the variable list from varMap,
 * and infer its type.
 * - Note: _inferVarTypes will determine the type of dependencies
 *         so it will have side effects of inferring types of other variables.
 */
let inferVarTypes = (varMap, schema, cseMap, nonEmptyGuarantees) => {
    let foundList = []
    let vars = Object.keys(varMap);
    while ((vars = vars.filter(varName => !foundList.includes(varName))).length > 0) {
        _inferVarTypes(vars[0], varMap, foundList, [], schema, cseMap, nonEmptyGuarantees)
    }
}

let removeVarDeps = (q) => {
    if(q.varDeps)
        q.varDeps = undefined;
    if(q.arg)
        q.arg.map(removeVarDeps);
}

let findSameDomains = (varMap) => {
    let vars = Object.keys(varMap);
    let sameDomains = {};
    while ((vars = vars.filter(varName => !Object.keys(sameDomains).includes(varName))).length > 0) {
        let varName = vars[0];
        let s1 = sets.unique(varMap[varName].exprs.map(getOp => getOp.arg[0]));
        for(let varName2 of vars) {
            if(varName == varName2)
                continue;
            let s2 = sets.unique(varMap[varName2].exprs.map(getOp => getOp.arg[0]));
            if(sets.equal(s1, s2)) {
                if(sameDomains[varName2]) {
                    sameDomains[varName2].push(varName);
                    sameDomains[varName] = sameDomains[varName2];
                } else {
                    let arr = [varName, varName2];
                    sameDomains[varName] = arr;
                    sameDomains[varName2] = arr;
                }
            }
        }
        if(!sameDomains[varName]) {
            sameDomains[varName] = [varName];
        }
    }
    return sameDomains;
}

typing.validateIR = (schema, q) => {
    if (schema === undefined)
        return undefined;
    schema = typing.parseType(schema);

    let varMap = {};
    let cseMap = {};
    let nonEmptyGuarantees = [];

    findVariables(q, varMap);
    let sameDomains = findSameDomains(varMap);
    removeVarDeps(q);
    inferVarTypes(varMap, schema, cseMap, nonEmptyGuarantees);

    validateIRQuery(schema, cseMap, varMap, nonEmptyGuarantees, q);
    return {
        sameDomains: sameDomains,
        query: convertAST(schema, q, {})
    };
}