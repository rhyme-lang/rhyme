const { pretty, prettyType, prettyTypeTuple } = require('./prettyprint')
const { sets } = require('./shared')
const { types, typeSyms, props } = require('./types')
const { runtime } = require('./simple-runtime')

const { unique, union, intersect, diff, subset, same } = sets

let typing = {}
exports.typing = typing;
exports.types = types;
exports.typeSyms = typeSyms;
exports.props = props;

let nothingSet = [props.nothing];
let errorSet = [props.error];


let typeEquals = (t1, t2) => isSubtype(t1, t2) && isSubtype(t2, t1)

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
        // both are commutative: a | b is the same type as b | a
        case "union":
            return sameType(t1.unionSet[0], t2.unionSet[0]) &&
                sameType(t1.unionSet[1], t2.unionSet[1]) ||
                sameType(t1.unionSet[0], t2.unionSet[1]) &&
                sameType(t1.unionSet[1], t2.unionSet[0]);
        case "intersect":
            return sameType(t1.intersectSet[0], t2.intersectSet[0]) &&
                sameType(t1.intersectSet[1], t2.intersectSet[1]) ||
                sameType(t1.intersectSet[0], t2.intersectSet[1]) &&
                sameType(t1.intersectSet[1], t2.intersectSet[0]);
        case "dynkey":
            return t1.keySymbol == t2.keySymbol;
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

// props of a value computed from all of these tuples
let unionProps = (tups) => tups.reduce((acc, tup) => union(acc, tup.props), []);

// A constant key is a property name: obj[0] and obj["0"] are the same lookup,
// so a number constant used as a key is typed as its string.
let keyTupOf = (q, tup) =>
    q.key == "const" && typeof q.op == "number" ? {type: String(q.op), props: tup.props} : tup;

let isObject = (type) => isSubtype(type, emptyObject);
typing.isObject = isObject;

let getObjectKeys = (obj) => {
    obj = removeTag(obj);
    if (obj.typeSym == typeSyms.never)
        return types.never;
    if (isUnknown(obj))
        return types.unknown;//typing.createKey(typing.createUnion(types.string, types.u64));
    if (!isObject(obj))
        return types.never;
    if (obj.typeSym == typeSyms.union)
        return createUnion(
            getObjectKeys(obj.unionSet[0]),
            getObjectKeys(obj.unionSet[1]),
        );
    // An intersection of objects combines their fields (see createIntersection,
    // which merges {a} & {b} into {a, b}), so its keys are those of either.
    if (obj.typeSym == typeSyms.intersect)
        return createUnion(
            getObjectKeys(obj.intersectSet[0]),
            getObjectKeys(obj.intersectSet[1]),
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
    // unknown narrowed by a type is that type (createUnion widens to unknown)
    if (isUnknown(t1))
        return t2;
    if (isUnknown(t2))
        return t1;
    if (isSubtype(t1, t2))
        return t1;
    if (isSubtype(t2, t1))
        return t2;
    if (typeDoesntIntersect(t1, t2)) {
        // console.warn(`Intersection of non-intersecting types results in Never: ${prettyType(t1)} and ${prettyType(t2)}`);
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
    // Two plain objects with disjoint keys merge into one. Anything else
    // (a tagged object, unknown) stays an intersection, rather than having
    // its fields silently dropped.
    if (t1.typeSym == typeSyms.object && t2.typeSym == typeSyms.object &&
        typeDoesntIntersect(getObjectKeys(t1), getObjectKeys(t2))) {
        let newObj = objBuilder();
        for (let obj = t1; obj.objParent != null; obj = obj.objParent) {
            newObj.add(obj.objKey, obj.objValue);
        }
        for (let obj = t2; obj.objParent != null; obj = obj.objParent) {
            newObj.add(obj.objKey, obj.objValue);
        }
        return newObj.build();
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
typing.createTaggedType = createTaggedType;

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
    let resProps = union(objectTup.props, keyTup.props);
    switch (objectTup.type.typeSym) {
        case typeSyms.unknown:
            return {
                type: types.unknown,
                props: union(resProps, errorSet)
            };
        case typeSyms.tagged_type:
            return performObjectGet(
                {type: removeTag(objectTup.type), props: objectTup.props},
                keyTup);
        case typeSyms.union: {
            let res1 = performObjectGet({type: objectTup.type.unionSet[0], props: objectTup.props}, keyTup);
            let res2 = performObjectGet({type: objectTup.type.unionSet[1], props: objectTup.props}, keyTup);
            return {
                type: createUnion(res1.type, res2.type),
                props: union(res1.props, res2.props)
            };
        }
        case typeSyms.object:
            if (objectTup.type.objValue === null) {
                return {
                    type: types.never,
                    props: union(resProps, nothingSet)
                };
            }
            let keyType = objectTup.type.objKey;
            let valueType = objectTup.type.objValue;
            let parent = objectTup.type.objParent;
            if (isSubtype(keyTup.type, keyType)) {
                return {
                    type: valueType, props: resProps
                };
            }
            let {type: t3, props: p3} = performObjectGet(intoTup(parent), keyTup);
            resProps = union(resProps, p3);
            if (typeDoesntIntersect(keyType, keyTup.type)) {
                return {
                    type: t3,
                    props: resProps
                };
            }
            return {
                type: createUnion(valueType, t3),
                props: resProps
            };
        case typeSyms.never:
            return {
                type: types.never,
                props: union(resProps, nothingSet)
            };
        case typeSyms.intersect: {
            let found = objectTup.type.intersectSet
                .map(type => performObjectGet({type, props: objectTup.props}, keyTup))
                .filter(res => !isNever(res.type));
            if (found.length == 0)
                return {type: types.never, props: union(resProps, nothingSet)};
            let surely = found.filter(res => !res.props.includes(props.nothing));
            let type = surely.length == found.length
                ? found.map(res => res.type).reduce(createIntersection)
                : found.map(res => res.type).reduce(createUnion);
            let foundProps = union(resProps, unionProps(found));
            return {type, props: surely.length > 0 ? diff(foundProps, nothingSet) : foundProps};
        }
        default:
            throw new Error("Unable to perform access on non-object type: " + prettyType(objectTup.type));
    }
}
typing.performObjectGet = performObjectGet;

const NUMBER_SUPERTYPES = {
    u8: ["u16", "i16"],
    u16: ["u32", "i32", "f32"],
    u32: ["u64", "i64", "f64"],
    u64: [],
    i8: ["i16"],
    i16: ["i32", "f32"],
    i32: ["i64", "f64"],
    i64: [],
    f32: ["f64"],
    f64: [],
};

// Reflexive-transitive closure: every number type each one is a subtype of.
let numberUpperBounds = {};
let closeUpperBounds = (sym) => numberUpperBounds[sym] ??=
    unique([sym, ...NUMBER_SUPERTYPES[sym].flatMap(closeUpperBounds)]);
Object.keys(NUMBER_SUPERTYPES).forEach(closeUpperBounds);

let isNumberSym = (sym) => NUMBER_SUPERTYPES[sym] !== undefined;

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
    if (type.typeSym === typeSyms.object && expectedType.typeSym === typeSyms.object) {
        // unknown is no object here: it conforms by consistency, not subtyping
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
    if (isNumberSym(type.typeSym) && isNumberSym(expectedType.typeSym))
        return numberUpperBounds[type.typeSym].includes(expectedType.typeSym);
    return false;
}

// typeConforms is same as isSubtype.
let typeConforms = (type, expectedType) => {
    if (sameType(type, expectedType))
        return true;
    if (type.typeSym === typeSyms.tagged_type || expectedType.typeSym === typeSyms.tagged_type)
        return typeConforms(removeTag(type), removeTag(expectedType));
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
            // A dynamic key conforms when its supertype does -- checked before a
            // union on the right is split, which the supertype may need whole.
            if (type.typeSym === typeSyms.dynkey && typeConforms(type.keySupertype, expectedType))
                return true;
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

// Whether the property name s is a key of the number key type: it spells a
// number of that type, as the key would print (no "01", "1.0" or "+1").
let isNumberKey = (s, numType) => {
    let n = Number(s);
    return s !== "" && String(n) === s && isSubtype(smallestTypeOf(n), generalizeNumber(numType));
}

let typeDoesntIntersect = (t1, t2) => {
    switch (t1.typeSym) {
        case typeSyms.never:
            return true;
        case typeSyms.any:
            if (t2.typeSym == typeSyms.never)
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
    switch (t2.typeSym) {
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
    // A property name spelling a number ('0') is also a key of a number key
    // type that holds it, e.g. an array index.
    if (typeof t1 === "string" && isNumber(t2))
        return !isNumberKey(t1, t2);
    if (typeof t2 === "string" && isNumber(t1))
        return !isNumberKey(t2, t1);
    let strT1 = "";
    let strT2 = "";
    if (isNumber(t1))
        strT1 = "num";
    if (isNumber(t2))
        strT2 = "num";
    if (isString(t1))
        strT1 = "str";
    if (isString(t2))
        strT2 = "str";
    if (isBoolean(t1))
        strT1 = "bool";
    if (isBoolean(t2))
        strT2 = "bool";
    if (isObject(t1))
        strT1 = "obj";
    if (isObject(t2))
        strT2 = "obj";
    if (strT1 != "" && strT2 != "")
        if (strT1 != strT2)
            return true;
    if (isString(t1) && isString(t2)) {
        // TODO: Non-empty guarantee of intersection of keys.
        if (t1.typeSym == typeSyms.dynkey || t2.typeSym == typeSyms.dynkey)
            return false;
        return true;
    }
    // TODO Other checks?
    return false;
}
typing.typeDoesntIntersect = typeDoesntIntersect;

// What an op expects of an operand, as types to be a subtype of. The kind
// predicates below are just subtype checks against these, so unions,
// intersections, tags, dynamic keys and never (the empty type, a subtype of
// every type) are all handled once, by the subtyping relation.
let unionOf = (...ts) => ts.reduceRight((rest, t) =>
    ({typeSym: typeSyms.union, unionSet: [t, rest]}));
let integerType = unionOf(types.u64, types.i64);
let numberType = unionOf(types.u64, types.i64, types.f64);
let keyType = unionOf(types.u64, types.i64, types.f64, types.string, types.char, types.date);
let emptyObject = objBuilder().build(); // a supertype of every object
typing.integerType = integerType;
typing.numberType = numberType;

let isInteger = (type) => isSubtype(type, integerType);
typing.isInteger = isInteger;

let isNumber = (type) => isSubtype(type, numberType);
typing.isNumber = isNumber;

let isBoolean = (type) => isSubtype(type, types.boolean);
typing.isBoolean = isBoolean;

// Includes string literals.
let isString = (type) => isSubtype(type, types.string);
typing.isString = isString;

let isKey = (type) => isUnknown(type) || isSubtype(type, keyType);
typing.isKey = isKey;

// An operand check: a subtype of what the op expects, or unknown, which is
// not a subtype of anything but accepted by consistency (and may fail at
// runtime).
let accepts = (type, expectedType) => isUnknown(type) || isSubtype(type, expectedType);
typing.accepts = accepts;

// The empty type: a missing value, e.g. an absent field or 'undefined'.
let isNever = (type) => removeTag(type).typeSym == typeSyms.never;
typing.isNever = isNever;

let isUnknown = (type) => {
    type = removeTag(type);
    if (type.typeSym == typeSyms.dynkey)
        return isUnknown(type.keySupertype);
    if (type.typeSym == typeSyms.unknown)
        return true;
    return false;
};
typing.isUnknown = isUnknown;

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

// Join of two primitive number types: their least common supertype in
// NUMBER_SUPERTYPES, e.g. u32 + i16 -> i64.
let joinNumber = (t1, t2) => {
    if (isSubtype(t1, t2))
        return t2;
    if (isSubtype(t2, t1))
        return t1;
    let common = numberUpperBounds[t1.typeSym].filter(sym =>
        numberUpperBounds[t2.typeSym].includes(sym));
    let minimal = common.filter(sym => !common.some(other =>
        other != sym && numberUpperBounds[other].includes(sym)));
    let sym = minimal.find(sym => isInteger(types[sym])) ?? minimal[0];
    return sym ? types[sym] : types.f64;
}
typing.joinNumber = joinNumber;

// Type of a number literal, as in C: an integer is i32, or i64 if it does not
// fit; anything else is f64. Combined with a typed operand it joins as any
// other value does, so x_u8 + 1 is i32 and x_u32 + 1 is i64.
let literalType = (n) => {
    if (!Number.isInteger(n))
        return types.f64;
    if (n >= -(2 ** 31) && n < 2 ** 31) return types.i32;
    if (n >= -(2 ** 63) && n < 2 ** 63) return types.i64;
    return types.f64;
}
typing.literalType = literalType;

// The smallest number type holding the number n (for key range checks).
let smallestTypeOf = (n) => {
    if (!Number.isInteger(n))
        return types.f64;
    if (n >= 0) {
        if (n <= 0xff) return types.u8;
        if (n <= 0xffff) return types.u16;
        if (n <= 0xffffffff) return types.u32;
        if (n < 2 ** 64) return types.u64;
        return types.f64;
    }
    if (n >= -(2 ** 7)) return types.i8;
    if (n >= -(2 ** 15)) return types.i16;
    if (n >= -(2 ** 31)) return types.i32;
    if (n >= -(2 ** 63)) return types.i64;
    return types.f64;
}

// The single primitive number type a value of this type is computed in.
// Unions and intersections collapse to their joinNumber, since no backend
// can represent a number whose type is only known at runtime.
let generalizeNumber = (type) => {
    if (isUnknown(type)) {
        return types.f64;
    }
    if (!isNumber(type))
        throw new Error("Unable to generalize non-number type: " + prettyType(type));
    switch (type.typeSym) {
        case typeSyms.union:
            return joinNumber(
                generalizeNumber(type.unionSet[0]),
                generalizeNumber(type.unionSet[1])
            );
        case typeSyms.intersect:
            // NOTE: a value of both fits either type, so the join is safe, but
            // the meet (the narrower one, e.g. u8 for u8 & u16) is more precise.
            return joinNumber(
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

let joinBranches = (t1, t2) => {
    if (!isUnknown(t1) && !isUnknown(t2) && isNumber(t1) && isNumber(t2))
        return generalizeNumber(createUnion(t1, t2));
    return createUnion(t1, t2);
}



let symIndex = 0;
let freshSym = (pref) => pref + (symIndex++);

// Types each node once and records the result on it: after deduplicate the IR
// is a DAG, so a shared node is reached along several paths.
let validateIRQuery = (schema, varMap, q) => {
    if (q.schema)
        return q.schema;

    let res = _validateIRQuery(schema, varMap, q);
    q.schema = res;
    return res;
};

let _validateIRQuery = (schema, varMap, q) => {
    if (q === undefined)
        throw new Error("Undefined query.");
    if (q.key === "input") {
        return intoTup(schema);
    } else if (q.key === "loadInput") {
        let argTups = q.arg.map(arg => validateIRQuery(schema, varMap, arg));
        let t1 = argTups[0].type;
        if (!accepts(t1, types.string)) {
            throw new Error("Filename in loadInput expected to be a string but got " + prettyType(t1))
        }
        return {type: q.inputSchema, props: argTups[0].props};
    } else if (q.key === "const") {
        if (typeof q.op === "object" && Object.keys(q.op).length === 0)
            return intoTup(objBuilder().build());
        if (typeof q.op === "number")
            return intoTup(literalType(q.op));
        if (typeof q.op === "string")
            return intoTup(q.op);
        if (typeof q.op === "boolean")
            return intoTup(types.boolean); // Should "false" be a boolean?
        if (q.op === undefined) {
            return {type: types.never, props: nothingSet}; // TODO: Undefined is a boolean? Specifically, false?
        }
        throw new Error("Unknown const: " + q.op)
    } else if (q.key === "var") {
        
        if(varMap[q.op] === undefined)
            throw new Error(`Unable to find definition for variable ${q.op}`);
        return varMap[q.op].varTup;

    } else if (q.key === "get") {
        let tup1 = validateIRQuery(schema, varMap, q.arg[0]);

        let t1 = tup1.type;
        let tup2 = validateIRQuery(schema, varMap, q.arg[1]);
        if (isUnknown(t1)) {
            return {
                type: types.unknown,
                props: union(tup1.props, union(tup2.props, union(nothingSet, errorSet)))
            }
        }
        if (!isObject(t1)) {
            throw new Error("Unable to perform get operation on non-object type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
        }
        return performObjectGet(tup1, keyTupOf(q.arg[1], tup2));
    } else if (q.key === "mkTuple") {
        // Constant-key record construction: the encoding of an 'update' chain
        // {}{k1 -> v1}{k2 -> v2}..., so it must report what that chain reports.
        // A field whose value is nothing is simply omitted; object types carry
        // no per-field optionality, so that absence surfaces as a 'nothing'
        // prop on the record itself (see performObjectGet).
        let res = {}
        let tupProps = []
        for (let i = 0; i < q.arg.length; i += 2) {
            let argTup1 = validateIRQuery(schema, varMap, q.arg[i]);
            let argTup2 = validateIRQuery(schema, varMap, q.arg[i + 1]);

            // Keys are constants (see preprocess), so name the field by the
            // key's value, as rt.mkTuple does -- its type is not a string for
            // a number key.
            res[q.arg[i].op] = argTup2.type;
            tupProps = union(tupProps, union(argTup1.props, argTup2.props));
        }
        return {type: createSimpleObject(res), props: tupProps};
    } else if (q.key === "pure") {
        let argTups = q.arg.map(arg => validateIRQuery(schema, varMap, arg));

        if (q.op == "apply") {
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1)) {
                return {
                    type: types.unknown,
                    props: argTups.reduce((acc, curr) => union(acc, curr.props), errorSet)
                };
            }
            if (isNever(t1))
                return {type: types.never, props: union(unionProps(argTups), nothingSet)};
            if (t1.typeSym != typeSyms.function)
                throw new Error(`Unable to apply a value to a non-function value (type ${prettyType(t1)})\nApplying to non-function: ${pretty(q.arg[0])}\nWith argument: ${pretty(q.arg[1])}`)
            if (t1.funcParams.length + 1 != argTups.length)
                throw new Error(`Unable to apply function "${pretty(q.arg[0])}". Number of args do not align.`);
            let resProps = [];
            for (let i = 0; i < argTups.length - 1; i++) {
                let {type, props: argProps} = argTups[i + 1];
                let expType = t1.funcParams[i];
                // An unknown argument is accepted, as by every other op, but
                // may turn out not to conform at runtime.
                if (isUnknown(type)) {
                    argProps = union(argProps, errorSet);
                } else if (!isSubtype(type, expType)) {
                    throw new Error(`Unable to apply function "${pretty(q.arg[0])}". Argument ${i + 1} does not align.\nExpected: ${prettyType(expType)}\nReceived: ${prettyType(type)}.`);
                }
                resProps = union(resProps, argProps);
            }
            // All inputs conform.
            return {type: t1.funcResult, props: resProps};
        } else if (q.op == "flatten") {
            if (q.arg.length == 0) {
                return {
                    type: objBuilder().build(), 
                    props: []
                };
            }
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1)) {
                return {
                    type: types.unknown,
                    props: argTups.reduce((acc, curr) => union(acc, curr.props), errorSet)
                };
            }

            // NOTE: types only the first argument's elements, but
            // rt.pure.flatten concatenates the arrays of all its arguments, so
            // with several the element type should be the union of theirs.
            let tup1 = validateIRQuery(schema, varMap, q.arg[0]);
            let innerTups = performObjectGet(tup1, intoTup(getObjectKeys(tup1.type)));
            let key = createKey(types.u32, "Flatten");
            return {
                type: objBuilder()
                    .add(key, innerTups.type).build(), 
                props: diff(innerTups.props,nothingSet)
            };

        } else if (q.op == "join") {
            // rt.pure.join: the elements of an array joined into one string
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1))
                return {type: types.string, props: union(p1, errorSet)};
            if (!isObject(t1))
                throw new Error("Unable to perform join operation on non-array: " + prettyType(t1));
            return {type: types.string, props: p1};

        } else if (q.op === "equal" || q.op === "and" || q.op === "notEqual" || q.op === "fdiv" || q.op == "concat" ||
            q.op === "plus" || q.op === "minus" || q.op === "times" || q.op === "div" || q.op === "mod" ||
            q.op === "lessThan" || q.op === "greaterThan" || q.op === "lessThanOrEqual" || q.op === "greaterThanOrEqual" ||
            q.op == "andAlso" || q.op == "orElse") {
            // If q is a binary operation:
            // TODO: Figure out difference between fdiv and div.
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];
            if (q.op == "concat") {
                if (accepts(t1, types.string) && accepts(t2, types.string))
                    return {
                        type: types.string,
                        props: union(p1, p2)
                    };
                throw new Error(`Unable to concatenate non-strings of type ${prettyType(t1)} and ${prettyType(t2)}. ` + pretty(q.arg[0]) + " and " + pretty(q.arg[1]));
            } else if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "div" || q.op == "mod") {
                if (!accepts(t1, numberType) || !accepts(t2, numberType)) {
                    throw new Error(`Unable to perform ${q.op} on non-numbers of type ${prettyType(t1)} and ${prettyType(t2)}. ` + pretty(q.arg[0]) + " and " + pretty(q.arg[1]));
                }
                // Computed in the operands' joined type, and wraps around
                // on overflow there (u8 + u8 is u8).
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
                let qProps = [];
                if(p1.includes(props.nothing) && p2.includes(props.nothing))
                    qProps.push(props.nothing)
                if(p1.includes(props.error) || p2.includes(props.error))
                    qProps.push(props.error)
                return {type: joinBranches(t1, t2), props: qProps};
            }
            throw new Error("Pure operation not implemented: " + q.op);
        } else if (q.op == "combine") {
            // a composite key: missing if any part is
            // NOTE: typed as its first part only, but the key is built from
            // all parts (see value.combinedKey in the C backend); its type
            // should be a tuple of the part types.
            return {type: argTups[0].type, props: unionProps(argTups)};
        } else if (q.op == "singleton") {
            // TODO Figure out what singleton does.
            let {type: t1, props: p1} = argTups[0];
            return {
                type: objBuilder().add(createKey(t1, "singleton"), types.boolean).build(),
                props: p1
            };
        } else if (q.op == "ifElse") {
            // TODO Figure out what ifElse does.
            let {type: t2, props: p2} = argTups[1];
            let {type: t3, props: p3} = argTups[2];
            // the condition only selects a branch, but its errors still surface
            let p1 = intersect(argTups[0].props, errorSet);
            return {type: joinBranches(t2, t3), props: union(p1, union(p2, p3))};
        } else if (q.op == "sort") {
            // rt.pure.sort: the values of an array or object, as an array
            let {type: t1, props: p1} = argTups[0];
            if (isUnknown(t1))
                return {type: types.unknown, props: union(unionProps(argTups), errorSet)};
            if (!isObject(t1))
                throw new Error("Unable to sort non-object type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
            let values = performObjectGet(argTups[0], intoTup(getObjectKeys(t1)));
            return {
                type: objBuilder().add(createKey(types.u32, "Sort"), values.type).build(),
                props: unionProps(argTups)
            };
        } else if (q.op == "hour") {
            // arg is an integer timestamp (see the C backend's gmtime call)
            let {type: t1, props: p1} = argTups[0];
            if (!accepts(t1, integerType))
                throw new Error("Unable to perform hour operation on non-integer type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
            return argTups[0]
        } else if (q.op == "year") {
            // arg has to be of type date
            let {type: t1, props: p1} = argTups[0];
            if (!accepts(t1, types.date))
                throw new Error("Unable to perform year operation on non-date type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));
            return argTups[0]
        } else if (q.op == "substr") {
            // arg has to be of type date
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];
            let {type: t3, props: p3} = argTups[2];
            if (!accepts(t1, types.string))
                throw new Error("Unable to perform substr operation on non-string type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));

            if (!accepts(t2, integerType))
                throw new Error("Unable to perform substr operation on non-integer indices: " + prettyType(t2) + "\nReceived from query: " + pretty(q.arg[1]));

            if (!accepts(t3, integerType))
                throw new Error("Unable to perform substr operation on non-integer indices: " + prettyType(t3) + "\nReceived from query: " + pretty(q.arg[2]));

            return {
                type: types.string,
                props: unionProps(argTups)
            }
        } else if (q.op == "like") {
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];
            if (!accepts(t1, types.string))
                throw new Error("Unable to perform like operation on non-string type: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));

            if (!accepts(t2, types.string))
                throw new Error("Unable to perform like operation on non-string pattern: " + prettyType(t2) + "\nReceived from query: " + pretty(q.arg[1]));

            return {
                type: types.boolean,
                props: union(unionProps(argTups), nothingSet)
            }
        } else if (q.op == "isUndef") {
            let {type: t1, props: p1} = argTups[0];
            return {type: types.boolean, props: union(p1, nothingSet)};
        } else if (q.op == "length") {
            // u32 like array keys; u64 would force BigInt in the js backend
            let {type: t1, props: p1} = argTups[0];
            return {type: types.u32, props: union(p1, nothingSet)};
        } else if (q.op == "dot") {
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];

            if (!isDense(t1) || t1.tagData.dim != 1)
                throw new Error("Expect dense vector of dim 1 but got: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));

            if (!isDense(t2) || t2.tagData.dim != 1)
                throw new Error("Expect dense vector of dim 1 but got: " + prettyType(t2) + "\nReceived from query: " + pretty(q.arg[1]));

            return {type: types.f32, props: union(p1, p2)}
        } else if (q.op == "matmul") {
            let {type: t1, props: p1} = argTups[0];
            let {type: t2, props: p2} = argTups[1];

            if (!isDense(t1)  || t1.tagData.dim != 2)
                throw new Error("Expect dense tensor of dim 2 but got: " + prettyType(t1) + "\nReceived from query: " + pretty(q.arg[0]));

            if (!isDense(t2) || t2.tagData.dim != 2)
                throw new Error("Expect dense tensor of dim 2 but got: " + prettyType(t2) + "\nReceived from query: " + pretty(q.arg[1]));

            return {type: t1, props: union(p1, p2)}
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key === "hint") {

        return {type: types.never, props: []};

    } else if (q.key === "mkset") {
        let argTup = validateIRQuery(schema, varMap, q.arg[0]);

        let keyType = argTup.type;
        let key = createKey(keyType, "Mkset");
        //if (isUnknown(keyType)) {
        //    key = createKey(types.string, "MksetUnk");
        //}
        return {
            type: objBuilder()
                .add(key, types.boolean)
                .build(),
            props: diff(argTup.props,nothingSet)
        }

    } else if (q.key === "prefix") {
        // rt.stateful.prefix: an array of the reducer's successive states,
        // one per input value, so each element is typed as the reducer is.
        // Uncached: the stateful node is a stand-in, not part of the IR.
        let stateTup = _validateIRQuery(schema, varMap, {...q, key: "stateful"});
        return {
            type: objBuilder()
                .add(createKey(types.u32, "Prefix"), stateTup.type)
                .build(),
            // starts out as [], so the array itself is always present
            props: diff(stateTup.props, nothingSet)
        };

    } else if (q.key === "stateful") {
        // TODO Fix order once filter variables are moved to top level.
        let argTups = q.arg.map(arg => validateIRQuery(schema, varMap, arg));

        let argTup = argTups[0];
        let argType = argTup.type;

        // Over no values, a reducer is left at its init value. As codegen
        // decides (initRequired in simple-codegen), that is rt.stateful.<op>_init,
        // and undefined in 'maybe' mode (sum?, ...) or for an op without one
        // (single, first, last, any). Only a reducer that binds variables can
        // see no values; one that binds none runs once, and is missing exactly
        // when its arg is.
        let mayBeEmpty = q.bnd === undefined || q.bnd.length > 0;
        let undefinedInit = q.mode === "maybe" || !((q.op + "_init") in runtime.stateful);
        let resProps = undefinedInit ? argTup.props : diff(argTup.props, nothingSet);
        if (undefinedInit && mayBeEmpty)
            resProps = union(resProps, nothingSet);

        if (q.op === "sum" || q.op === "product") {
            // Check if each arg is a number.
            if (!accepts(argType, numberType))
                throw new Error(`Unable to ${q.op} non-number values currently. Got: ${prettyType(argType)}`);
            // Accumulates in the argument's own type, wrapping around on
            // overflow (a sum over u8 is u8), as the C backend does. Over only
            // missing values it is just its init value, typed like a literal.
            return {type: isNever(argType) ? types.i32 : generalizeNumber(argType), props: resProps};
        } else if (q.op === "min" || q.op === "max") {
            if (!accepts(argType, numberType))
                throw new Error(`Unable to ${q.op} non-number values currently. Got: ${prettyType(argType)}`);
            // NOTE: over no values, the result is the init value -- +-Infinity
            // in js, the type's limits in C -- not nothing. With only missing
            // values there is no type to take limits from, hence f64.
            return  {type: isNever(argType) ? types.f64 : generalizeNumber(argType), props: resProps};

        } else if (q.op === "count") {
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.u32, props: resProps};
        } else if (q.op === "all" || q.op === "any") {
            if (!accepts(argType, types.boolean))
                throw new Error(`Unable to use "${q.op}" operator on non-boolean type. Got: ${prettyType(argType)}`);
            // As long as the argument is valid, it doesn't matter what type it is.
            return {type: types.boolean, props: union(resProps, nothingSet)};
        } else if (q.op === "single" || q.op === "first" || q.op === "last") {
            return {type: argType, props: resProps};
        } else if (q.op === "array") {
            // If Nothing is included in the object definition, remove it.
            // Because array's only accumulate non-nothing values.
            // TODO: See if we should default to size of array as u32 here.
            let key = createKey(types.u32, "Array");
            return {
                type: objBuilder()
                    .add(key, argType).build(), 
                props: resProps
            };
        } else if (q.op === "print") {
            return {type: types.never, props: []};
        } else if (q.op == "mkset") {
            // TODO: Get rid of mkset stateful?
            let argTup = validateIRQuery(schema, varMap, q.arg[0]);

            let keyType = argTup.type;
            let key = keyType;//createKey(keyType, "Mkset");
            if (isUnknown(keyType)) {
                key = createKey(types.string, "MksetUnk");
            }
            return {
                type: objBuilder()
                    .add(key, types.boolean)
                    .build(),
                props: diff(argTup.props,nothingSet)
            }
        }

        throw new Error("Unimplemented stateful expression " + q.op);

    } else if (q.key === "update") {
        if (q.arg[3])  validateIRQuery(schema, varMap, q.arg[3]);
        let argTup1 = validateIRQuery(schema, varMap, q.arg[0]);
        let argTup3 = validateIRQuery(schema, varMap, q.arg[2]);

        let {type: parentType, props: p1} = argTup1;
        if (!isUnknown(parentType) && !isObject(parentType))
            throw new Error("Unable to update field of type: " + prettyType(parentType));
        //let t3 = argTups[2].type;
        let arg2 = q.arg[1];
        let argTup2;
        if (arg2.op === "vars") {
            for (let argI = q.arg[1].arg.length - 1; argI > 0; argI--) {
                let keyTup = validateIRQuery(schema, varMap, q.arg[1].arg[argI]);
                // inner levels of a key (vars *A *B ...): {*B: value}, ...
                argTup3 = {
                    type: {
                        typeSym: typeSyms.object,
                        objKey: keyTup.type,
                        objValue: argTup3.type,
                        objParent: objBuilder().build()
                    },
                    props: union(keyTup.props, argTup3.props)
                };
            }
            argTup2 = validateIRQuery(schema, varMap, q.arg[1].arg[0]);
        } else {
            argTup2 = keyTupOf(arg2, validateIRQuery(schema, varMap, arg2));
        }

        let {type: keyType, props: p2} = argTup2;
        let key = keyType;// createKey(keyType, "update");

        let {type: valueType, props: p3} = argTup3;
        if (!isKey(keyType))
            throw new Error("Unable to use type: " + prettyType(keyType) + " as object key");

        let resProps = union(p2, p3);
        return {
            type: {
                typeSym: typeSyms.object,
                objKey: key,
                objValue: valueType,
                objParent: parentType
            },
            props: union(resProps, p1) // TODO: Nothing property? {*a: nothing} -> nothing, so nothing property should be included?
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
let parseTypeString_Atom = (stream, vars) => {
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
        let objResult = typing.objBuilder();
        if (stream.peek() != "}") {
            let key = parseTypeString_Infix(stream, vars);
            stream.expect(":");
            let val = parseTypeString_Infix(stream, vars);
            objResult.add(key, val)
            while (stream.peek() == ",") {
                stream.expect(",");
                let key = parseTypeString_Infix(stream, vars);
                stream.expect(":");
                let val = parseTypeString_Infix(stream, vars);
                objResult.add(key, val)
            }
        }
        stream.expect("}")
        return objResult.build();
    }
    if (stream.peek() == "[") {
        stream.expect("[");
        let resType = parseTypeString_Infix(stream, vars);
        stream.expect("]");
        return typing.objBuilder()
            .add(typing.createKey(types.u32), resType)
            .build();
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
    if (stream.peek() == "*") {
        stream.expect("*");
        let type = parseTypeString_Infix(stream, vars);
        // If *u8=A has been done before, set *A to refer to the same key.
        let key
        if (typeof type === "string") {
            if (vars[type])
                key = vars[type]
        } else if (stream.peek() === "=") {
            stream.expect("=");
            let match = stream.substring().match(/^([a-zA-Z0-9]+)/);
            if (!match)
                throw new Error(`Error when parsing type: Unknown identifier at ${stream.substring()}`);
            key = typing.createKey(type, match[1]);
            vars[match[1]] = key;
            stream.consume(match[1].length);
        } else {
            key = typing.createKey(type);
        }
        return key;
    }
    let match = stream.substring().match(/^([a-zA-Z0-9\-_]+)($|[|&\s,\:\[\]\{\}\*\(\)=])/);
    if (!match)
        throw new Error(`Error when parsing type: Unknown type at ${stream.substring()}`);
    stream.consume(match[1].length);

    if (Object.values(types).map((obj) => obj.typeSym).includes(match[1]))
        return types[match[1]];
    return match[1];
}

let parseTypeString_Infix = (stream, vars) => {
    let exp = parseTypeString_Atom(stream, vars);
    while (stream.peek() == "&" || stream.peek() == "|") {
        let char = stream.peek();
        stream.expect(char);
        let nextExp = parseTypeString_Atom(stream, vars);
        if (char == "&") {
            exp = typing.createIntersection(exp, nextExp);
        } else if (char == "|") {
            exp = typing.createUnion(exp, nextExp);
        }
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
            if (valueType.typeSym == typeSyms.keyval) {
                keyType = typing.parseType(valueType.keyvalKey);
                valueType = typing.parseType(valueType.keyvalValue);
            }
            // Recurse until the base object is reached, then construct object.
            let parent = typing.parseType(newSchema);
            return {
                typeSym: typeSyms.object,
                objKey: keyType,
                objValue: valueType,
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
        default:
            return schema;
    }
}


typing.parseTypeAST = (q) => {
    let error = (msg) => { throw new Error("Error when parsing type: " + msg + ": " + JSON.stringify(q)) };
    switch (q.xxkey) {
        case "hole": // a type spliced in from JS
            if (typeof q.xxop === "object" && q.xxop !== null && q.xxop.typeSym !== undefined)
                return q.xxop;
            error("type expected in hole");
        case "ident": {
            if (q.xxop.startsWith("*")) {
                let name = q.xxop.substring(1);
                if (!Object.hasOwn(types, name)) error("unknown key type '" + name + "'");
                return createKey(types[name]);
            }
            if (!Object.hasOwn(types, q.xxop)) error("unknown type '" + q.xxop + "'");
            return types[q.xxop];
        }
        case "const":
            if (typeof q.xxop !== "string") error("unsupported literal type");
            return q.xxop;
        case "object": {
            let builder = objBuilder();
            for (let i = 0; i < q.xxparam.length; i += 2) {
                let k = q.xxparam[i];
                let key = k.xxkey == "ident" && !k.xxop.startsWith("*") ? k.xxop : typing.parseTypeAST(k);
                builder.add(key, typing.parseTypeAST(q.xxparam[i+1]));
            }
            return builder.build();
        }
        case "array":
            if (q.xxparam.length != 1) error("array type expects one element type");
            return objBuilder().add(createKey(types.u32), typing.parseTypeAST(q.xxparam[0])).build();
        case "pipe":
            return createUnion(typing.parseTypeAST(q.xxparam[0]), typing.parseTypeAST(q.xxparam[1]));
        case "and":
            return createIntersection(typing.parseTypeAST(q.xxparam[0]), typing.parseTypeAST(q.xxparam[1]));
        default:
            error("unsupported type syntax");
    }
}

let unwrapType = (type) => {
    switch (type.typeSym) {
        case typeSyms.tagged_type:
            return unwrapType(type.tagInnertype);
        case typeSyms.dynkey:
            return unwrapType(type.keySupertype);
        case typeSyms.union:
            return createUnion(
                unwrapType(type.unionSet[0]),
                unwrapType(type.unionSet[1])
            )
        case typeSyms.intersect:
            return createIntersection(
                unwrapType(type.intersectSet[0]),
                unwrapType(type.intersectSet[1])
            )
    }
    return type;
}

let convertQuery = (q, type) => {
    // A value that cannot exist needs no conversion, and has no type to
    // convert to.
    if (isNever(type))
        return q;
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

    if (curType.typeSym === typeSyms.union || curType.typeSym === typeSyms.intersect)
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

let convertAST = (schema, q, dontConvertVar = false) => {
    let $convertAST = (q, dontConvertVar = false) => convertAST(schema, q, dontConvertVar);

    if (q.key == "input") {
        return q;
    } else if (q.key === "loadInput") {
        return q;
    } else if (q.key == "const") {
        return q;
    } else if (q.key == "var") {
        // TODO: Number | String union type is (perhaps) impossible to handle as key.
        // Atleast it is without a check that converts it to a number iff matches \-?[1-9][0-9]*(\.[1-9][0-9]*)?\
        if (isNumber(q.schema.type) && !isNever(q.schema.type) && !dontConvertVar) {
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
    } else if (q.key === "get") {
        q.arg = q.arg.map((q) => $convertAST(q, true));
        // Assuming the object is well-formed, the result doesn't need converted.
        return q;
    } else if (q.key == "hint") {
        throw new Error("Unknown.");
    } else if (q.key == "mkTuple") {
        q.arg = q.arg.map($convertAST);
        return q;
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
                
                // the type the checker computed
                let resType = q.schema.type;
                q.arg = q.arg.map((q) => convertQuery($convertAST(q), resType));
                if (isNever(resType))
                    return q;
                
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
                q.arg = q.arg.map($convertAST);
                return q;
            } else if (q.op == "andAlso") {
                q.arg = q.arg.map($convertAST);
                return q;
            } else if (q.op == "orElse") {
                q.arg = q.arg.map($convertAST);
                return q;
            }
            throw new Error("Pure operation not implemented: " + q.op);
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
        } else if (q.op === "hour") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "substr") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "isUndef") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op === "like") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op == "length") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op == "singleton") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op == "dot") {
            q.arg = q.arg.map($convertAST);
            return q;
        } else if (q.op == "matmul") {
            q.arg = q.arg.map($convertAST);
            return q;
        }
        throw new Error("Pure operation not implemented: " + q.op);
    } else if (q.key == "stateful") {
        q.arg = q.arg.map($convertAST);
        if ((q.op == "sum" || q.op == "product") && !isNever(q.schema.type)) {
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

let findDependencies = (q) => {
    if(q.varDeps)
        return q.varDeps;
    let deps = $findDependencies(q);
    q.varDeps = deps;
    return deps;
}

let $findDependencies = (q) => {
    if(q.key == "var")
        return [q.op];
    if(q.arg)
        return q.arg.reduce((prev, curr) => union(findDependencies(curr), prev), []);
    return [];
}

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
        if (!deps)
            console.log(deps);
        varMap[name] = {
            var: name,
            deps: deps,
            exprs: [q],
        }
    }
} // data.*A + sum(data.*A)

let _inferVarTypes = (varName, varMap, foundList, pathList, schema) => {
    if (foundList.includes(varName))
        return;
    if (pathList.includes(varName)) {
        // console.warn("Unable to do topological sort on circular dependencies when determining types of variable: " + nextDep + "\nDefaulting to unknown.");
        varMap[varName].varTup = intoTup(types.unknown);
        foundList.push(varName);
        return;
    }
    let deps = varMap[varName].deps;

    let unfoundDeps;
    pathList.push(varName);
    while ((unfoundDeps = deps.filter(dep => !foundList.includes(dep))).length > 0) {
        let nextDep = unfoundDeps[0];
        _inferVarTypes(nextDep, varMap, foundList, pathList, schema);
    }
    pathList.splice(pathList.length - 1, 1);

    // A variable ranges over the keys every strict generator (data.*A) has in
    // common. A maybe generator (data.*A?) does not restrict it, so with only
    // those, it ranges over the keys of any of them -- e.g. an outer join.
    let keysOf = (query) => getObjectKeys(validateIRQuery(schema, varMap, query.arg[0]).type);
    let exprs = varMap[varName].exprs;
    let strict = exprs.filter(query => query.mode !== "maybe");
    // (no seed: a variable has at least one generator)
    let varType = strict.length > 0
        ? strict.map(keysOf).reduce(createIntersection)
        : exprs.map(keysOf).reduce(createUnion);
    // the maybe generators are still typed, as part of their own expressions
    exprs.forEach(keysOf);
    varMap[varName].varTup = intoTup(varType);
    foundList.push(varName);
}

let inferVarTypes = (varMap, schema) => {
    let foundList = []
    let vars = Object.keys(varMap);
    while ((vars = vars.filter(varName => !foundList.includes(varName))).length > 0) {
        _inferVarTypes(vars[0], varMap, foundList, [], schema)
    }
}

let removeVarDeps = (q) => {
    if(q.varDeps)
        q.varDeps = undefined;
    if(q.arg)
        q.arg.map(removeVarDeps);
}

typing.validateIR = (schema, q, convert = true) => {
    if (schema === undefined)
        return undefined;
    schema = typing.parseType(schema);

    let varMap = {};

    findVariables(q, varMap);
    removeVarDeps(q);
    inferVarTypes(varMap, schema);

    validateIRQuery(schema, varMap, q);
    if (!convert) return q;
    return convertAST(schema, q);
}