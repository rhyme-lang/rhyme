const { typing, types, props } = require("../../src/typing");
const { rh } = require("../../src/parser");
const { api } = require("../../src/rhyme");
const { compile } = require("../../src/simple-eval");
const { compileCrossCheck } = require("../utils");

/*
Test internal typing functions
- typeEquals (subtyping both ways)
- isSubtype (typeConforms)
- typeDoesntIntersect

- performObjectGet
- parseType?
*/

test("equals-basic", () => {
    expect(typing.typeEquals(types.u8, types.u8)).toBe(true);
    expect(typing.typeEquals(types.u8, types.u16)).toBe(false);
})

test("equals-obj", () => {
    // Check that two objects with the same value but different reference are the same.
    let obj1 = typing.parseType({x: types.u8, y: types.u16});
    let obj2 = typing.parseType({x: types.u8, y: types.u16});
    expect(typing.typeEquals(obj1, obj2)).toBe(true);
    // Check that an object that is different doesn't return true.
    let obj3 = typing.parseType({y: types.u8, x: types.u16});
    expect(typing.typeEquals(obj2, obj3)).toBe(false);
    
    // Check that objects in different orders properly recognize non-intersection of keys.
    let nonintersect1 = typing.parseType({x: types.u16, y: types.u8});
    let nonintersect2 = typing.parseType({y: types.u8, x: types.u16});
    expect(typing.typeEquals(nonintersect1, nonintersect2)).toBe(true);
})

test("equals-obj-gcd", () => {
    let keyval = typing.keyval(typing.createKey(types.string), types.u16);
    // Verify that objects with the same key are the same.
    let equal1 = typing.parseType({"-": keyval});
    let equal2 = typing.parseType({"-": keyval});
    expect(typing.typeEquals(equal1, equal2)).toBe(true);

    // Order of arguments is important when non-intersection isn't guaranteed.
    // As such, test that they are equal, even when not obvious.
    let gcd1 = typing.parseType({"-": keyval, y: types.u16});
    let gcd2 = typing.parseType({y: types.u8, "-": keyval});
    // A lookup of "y" results in u16 for gcd1, and u16 u u8 = u16 for gcd2.
    // Therefore, they are equivalent.
    expect(typing.typeEquals(gcd1, gcd2)).toBe(true);

    // However, a lookup of "y" *before* a key yields only u8, not u16, hence not equal.
    let gcd3 = typing.parseType({"-": keyval, y: types.u8});
    expect(typing.typeEquals(gcd1, gcd3)).toBe(false);

    let gcd4 = typing.parseType({y: types.u16, "-": keyval});
    let gcd5 = typing.parseType({y: types.u8, "-": keyval});
    expect(typing.typeEquals(gcd4, gcd5)).toBe(true);
})

test("subtype-basic", () => {
    expect(typing.isSubtype(types.u8, types.i16)).toBe(true);
    expect(typing.isSubtype(types.u8, types.u16)).toBe(true);
    expect(typing.isSubtype(types.u16, types.u8)).toBe(false);

    let keyval = typing.keyval(typing.createKey(types.string), types.u16);
    let obj1 = typing.parseType({"-": keyval});
    let obj2 = typing.parseType({y: types.u16});
    expect(typing.isSubtype(obj1, obj2)).toBe(false);
    let obj3 = typing.parseType({"-": keyval});
    expect(typing.isSubtype(obj1, obj3)).toBe(true);
})

test("subtype-function", () => {
    let func1 = typing.createFunction(types.string, types.u16);
    let func2 = typing.createFunction(types.string, types.u32);
    let func3 = typing.createFunction("A", types.u16);
    // Verify arguments are contravariant
    expect(typing.isSubtype(func2, func1)).toBe(true);
    expect(typing.isSubtype(func1, func2)).toBe(false);
    // Verify results are covariant.
    expect(typing.isSubtype(func3, func1)).toBe(true);
    expect(typing.isSubtype(func1, func3)).toBe(false);
    
    let func4 = typing.createFunction("A", types.u32);
    expect(typing.isSubtype(func4, func1)).toBe(true);
    expect(typing.isSubtype(func1, func4)).toBe(false);
})

test("union-basic", () => {
    expect(typing.createUnion(types.u8, types.u16)).toBe(types.u16);
    expect(typing.createUnion(types.u8, types.i16)).toBe(types.i16);

    expect(typing.createUnion(types.string, typing.createKey(types.string))).toBe(types.string);
})

test("insersect-basic", () => {
    expect(typing.createIntersection(types.u8, types.i16)).toBe(types.u8);
    expect(typing.createIntersection(types.string, types.i16)).toBe(types.never);
    expect(typing.createIntersection("A", "B")).toBe(types.never);
    expect(typing.createIntersection("A", "A")).toBe("A");
})

test("no-intersect-basic", () => {
    // Items that are subtypes will intersect.
    expect(typing.typeDoesntIntersect(types.u8, types.i16)).toBe(false);
    // Concrete types that don't intersect should immediately be true.
    expect(typing.typeDoesntIntersect(types.string, types.i16)).toBe(true);
    // Specific strings should not intersect if they're different
    expect(typing.typeDoesntIntersect("A", "B")).toBe(true);
    expect(typing.typeDoesntIntersect("A", "A")).toBe(false);
    // TODO: Should non-key types be checked?
    // typeDoesntIntersect is only ever ran on key types.
})

test("no-intersect-basic-keys", () => {
    let k1 = typing.createKey(types.u8);
    let k2 = typing.createKey(types.u8);
    let k3 = typing.createKey(types.u16);
    let k4 = typing.createKey(types.string);

    // Integer keys can intersect.
    expect(typing.typeDoesntIntersect(k1, k2)).toBe(false);
    expect(typing.typeDoesntIntersect(k2, k3)).toBe(false);
    // String and Integer keys will never intersect.
    expect(typing.typeDoesntIntersect(k3, k4)).toBe(true);
})

test("no-intersect-dynkey-supertype", () => {
    // a dynamic key is disjoint from whatever its supertype is disjoint from
    let ab = typing.createKey(typing.createUnion("A", "B"));
    expect(typing.typeDoesntIntersect(ab, "total")).toBe(true);
    expect(typing.typeDoesntIntersect("total", ab)).toBe(true);
    expect(typing.typeDoesntIntersect(ab, "A")).toBe(false);
    expect(typing.typeDoesntIntersect(ab, typing.createKey(typing.createUnion("C", "D")))).toBe(true);
    expect(typing.typeDoesntIntersect(ab, typing.createKey(typing.createUnion("B", "C")))).toBe(false);
    // keys of the same supertype may coincide
    expect(typing.typeDoesntIntersect(typing.createKey(types.string), typing.createKey(types.string))).toBe(false);
    expect(typing.typeDoesntIntersect(typing.createKey(types.string), "total")).toBe(false);
    // so a fixed field next to grouped keys is looked up on its own
    let obj = typing.objBuilder().add("total", types.u32).add(ab, types.f64).build();
    expect(typing.performObjectGet({type: obj, props: []}, {type: "total", props: []}))
        .toEqual({type: types.u32, props: []});
})


test("no-intersect-any-never", () => {
    expect(typing.typeDoesntIntersect(types.any, types.never)).toBe(true);
})

test("same-type-union", () => {
    let u1 = typing.createUnion(types.u32, types.string);
    let u2 = typing.createUnion(types.string, types.u32);
    expect(typing.sameType(u1, u2)).toBe(true);
})

test("kind-string-tagged", () => {
    let t = typing.createTaggedType("t", {}, typing.createUnion(types.string, "a"));
    expect(typing.isString(t)).toBe(true);
})

test("intersect-tagged-object", () => {
    // fields of a tagged object must not be dropped
    let tagged = typing.createTaggedType("dense", {dim: 1}, typing.createSimpleObject({a: types.u32}));
    let plain = typing.createSimpleObject({b: types.string});
    let res = typing.createIntersection(tagged, plain);
    expect(typing.isSubtype(res, plain)).toBe(true);
    expect(typing.isSubtype(res, tagged)).toBe(true);
})

test("kind-basic", () => {
    // never is a subtype of every type, so every kind predicate holds for it
    for (let p of ["isInteger", "isNumber", "isString", "isBoolean", "isObject", "isKey"])
        expect(typing[p](types.never)).toBe(true);
    // tags and dynamic keys are looked through, unions need every member
    let tagged = typing.createTaggedType("t", {}, typing.createUnion(types.string, "a"));
    expect(typing.isString(tagged)).toBe(true);
    expect(typing.isInteger(typing.createKey(types.u32))).toBe(true);
    expect(typing.isNumber(typing.createUnion(types.u32, types.f32))).toBe(true);
    expect(typing.isNumber(typing.createUnion(types.u32, types.string))).toBe(false);
    expect(typing.isNumber(types.date)).toBe(false);
    expect(typing.isKey(types.date)).toBe(true);
})

test("subtype-unknown", () => {
    // unknown is accepted by consistency (typing.accepts), not subtyping
    let obj = typing.createSimpleObject({a: types.u32});
    expect(typing.isSubtype(obj, types.unknown)).toBe(false);
    expect(typing.isSubtype(types.unknown, typing.objBuilder().build())).toBe(false);
    expect(typing.isSubtype(types.u32, types.unknown)).toBe(false);
    expect(typing.accepts(types.unknown, types.string)).toBe(true);
    // ...and like every kind predicate, isObject does not hold for it
    expect(typing.isObject(types.unknown)).toBe(false);
})

test("subtype-dynkey-union", () => {
    // a dynamic key conforms when its supertype does, also against a union
    let u = typing.createUnion(types.u64, types.i8);
    expect(typing.isNumber(typing.createKey(u))).toBe(true);
    expect(typing.isKey(typing.createKey(typing.createUnion(types.string, types.u32)))).toBe(true);
    let key = typing.createKey(types.u32);
    expect(typing.isSubtype(key, typing.createUnion(key, types.string))).toBe(true);
})

test("intersect-object-keys", () => {
    let inter = typing.createIntersection(
        typing.createSimpleObject({a: types.u32, b: types.u8}), typing.createSimpleObject({a: types.string}));
    expect(typing.isSubtype(typing.getObjectKeys(inter), typing.createUnion("a", "b"))).toBe(true);
    // objects share no values with numbers
    expect(typing.createIntersection(types.u32, typing.createSimpleObject({a: types.u8}))).toBe(types.never);
    // unknown narrowed by a type is that type
    let key = typing.createKey(types.u32);
    expect(typing.createIntersection(key, types.unknown)).toBe(key);
    expect(typing.createIntersection(types.unknown, types.unknown)).toBe(types.unknown);
})

test("stateful-maybe-nothing", () => {
    let schema = typing.parseType`{data: {*u32: {x: u32}}, one: {x: u32}}`
    let propsOf = (q) => compileCrossCheck(rh([q]), { schema }).explain2.resultType.props
    for (let q of ["sum?(data.*A.x)", "max?(data.*A.x)", "first(data.*A.x)", "last(data.*A.x)", "single(data.*A.x)"])
        expect(propsOf(q)).toContain(props.nothing)
    // init values are present...
    for (let q of ["sum(data.*A.x)", "count(data.*A.x)", "max(data.*A.x)"])
        expect(propsOf(q)).not.toContain(props.nothing)
    // ...and a reducer binding no variable runs exactly once
    expect(propsOf("first(one.x)")).not.toContain(props.nothing)
})

test("mktuple-number-key", () => {
    // a record field is named by its key's value, also for a number key
    let schema = typing.parseType`{data: {x: u32}}`
    let func = compileCrossCheck(rh`{0: data.x}`, { schema, mkTuple: true })
    let type = func.explain2.resultType.type
    expect(type.objKey).toBe("0")
    expect(type.objValue).toBe(types.u32)
})

test("never-operand", () => {
    // a missing field is accepted wherever any value is, and the result is
    // missing too -- not only by arithmetic
    let schema = typing.parseType`{data: {*u32: {x: u32}}}`
    let data = [{x: 1}]
    for (let q of [api.concat(rh`data.*A.y`, rh`"!"`), api.like(rh`data.*A.y`, rh`"a%"`), rh`data.*A.y.z`]) {
        let func = compile(q, { schema })
        expect(func({data})).toEqual({})
    }
    expect(compile(api.all(rh`data.*A.y`), { schema }).explain.resultType.props).toContain(props.nothing)
    // a reducer over only missing values is its init value, with a real type
    let func = compile(rh`sum(data.*A.y)`, { schema, typeConversions: true })
    expect(func({data})).toBe(0)
    expect(func.explain.resultType.type).toBe(types.i32)
})

test("sort-array", () => {
    // rt.pure.sort: the values of an array or object, as an array
    let schema = typing.parseType`{data: {*u32: {k: string, x: u32}}}`
    let func = compile(api.sort(rh`{data.*A.k: sum(data.*A.x)}`), { schema })
    expect(func({data: [{k: "b", x: 2}, {k: "a", x: 1}]})).toEqual([2, 1])
    let type = func.explain.resultType.type
    expect(typing.isInteger(type.objKey)).toBe(true)
    expect(type.objValue).toBe(types.u32)
})

test("generator-maybe-keys", () => {
    // *A ranges over the keys of data or other, so data.*A? may be missing,
    // and the optimizer must not assume it is present
    let schema = typing.parseType`{data: {*u32: u32}, other: {*u32: u32}}`
    let input = {data: [1, 2], other: [10, 20, 30]}
    for (let enableOptimizations of [false, true]) {
        let func = compile(rh`{*A: (data.*A? || 0) + (other.*A? || 0)}`, { schema, enableOptimizations })
        expect(func(input)).toEqual({0: 11, 1: 22, 2: 30})
        expect(func.explain.ir.filters[0].schema.props).toContain(props.nothing)
    }
    // a strict generator still restricts the domain
    let func = compile(rh`{*A: data.*A + (other.*A? || 0)}`, { schema })
    expect(func.explain.ir.filters[0].schema.props).not.toContain(props.nothing)
})

test("update-multi-key", () => {
    // the top-level group over several free variables nests well-formed objects
    let schema = typing.parseType`{data: {*u32: {y: u32}}}`
    let func = compile(rh`data.*A.y + data.*B.y`, { schema, singleResult: false })
    let inner = func.explain.resultType.type.objValue
    expect(inner.objParent).toEqual(typing.objBuilder().build())
    expect(inner.objValue).toBe(types.u32)
})

test("get-number-key", () => {
    // obj[0] and obj["0"] are the same lookup
    let schema = typing.parseType`{data: {0: u32}, arr: {*u32: string}}`
    let typeOf = (q) => compile(rh([q]), { schema }).explain.resultType
    expect(typeOf("data.0")).toEqual({type: types.u32, props: []})
    // an array index may be out of range
    let t = typeOf("arr.0")
    expect(t.type).toBe(types.string)
    expect(t.props).toContain(props.nothing)
    // only the canonical spelling of a number in range is a number key
    let key = typing.createKey(types.u32)
    expect(typing.typeDoesntIntersect("0", key)).toBe(false)
    expect(typing.typeDoesntIntersect("5", typing.createKey(types.i8))).toBe(false)
    expect(typing.typeDoesntIntersect("200", typing.createKey(types.i8))).toBe(true)
    for (let s of ["01", "-1", "1.5", "4294967296", "x"])
        expect(typing.typeDoesntIntersect(s, key)).toBe(true)
})

test("get-intersect-object", () => {
    // a value of both objects has the fields of either
    let inter = typing.createIntersection(
        typing.createSimpleObject({a: types.u32, b: types.u8}), typing.createSimpleObject({a: types.u16, c: types.string}))
    let schema = typing.createSimpleObject({d: inter})
    let typeOf = (q) => compile(rh([q]), { schema }).explain.resultType
    expect(typeOf("d.a")).toEqual({type: types.u16, props: []}) // in both: of both types
    expect(typeOf("d.b")).toEqual({type: types.u8, props: []})
    expect(typeOf("d.c")).toEqual({type: types.string, props: []})
    expect(typeOf("d.z").props).toContain(props.nothing)
    // a key that may name fields of either side is of either type
    let vec = typing.createVec("dense", types.u32, 1, types.f32)
    let tagged = typing.createSimpleObject({v: typing.createIntersection(vec, typing.createSimpleObject({name: types.string}))})
    let all = compile(rh`v.*i`, { schema: tagged }).explain.resultType.type
    expect(typing.isSubtype(all.objValue, typing.createUnion(types.f32, types.string))).toBe(true)
    expect(compile(rh`v.name`, { schema: tagged }).explain.resultType.type).toBe(types.string)
})

test("get-union-key", () => {
    let get = (obj, key) => typing.performObjectGet({type: obj, props: []}, {type: key, props: []})
    let ab = typing.createUnion("a", "b")
    // a union key is missing only if one of its members may be
    let both = typing.createSimpleObject({a: types.u8, b: types.u16})
    expect(get(both, ab)).toEqual({type: types.u16, props: []})
    expect(get(typing.createSimpleObject({a: types.u8}), ab).props).toContain(props.nothing)
    expect(typing.isSubtype(both, typing.objBuilder().add(ab, types.u16).build())).toBe(true)
    // a dynamic key is surely present if all of its supertype's values are
    let key = typing.createKey(typing.createUnion("A", "B"))
    expect(get(typing.createSimpleObject({A: types.u8, B: types.u8}), key)).toEqual({type: types.u8, props: []})
    expect(get(typing.createSimpleObject({A: types.u8}), key).props).toContain(props.nothing)
    expect(get(typing.objBuilder().add(typing.createKey(types.u32), types.u8).build(), typing.createKey(types.u32)).props)
        .toContain(props.nothing)
    // iterating over a record's fields: each is present
    let schema = typing.parseType`{data: {a: u8, b: string}}`
    expect(compile(rh`{*K: data.*K}`, { schema }).explain.resultType.props).toEqual([])
})

test("branch-taken", () => {
    let schema = typing.parseType`{data: {*u32: {x: u8, y: i8, s: string}}}`
    let typeOf = (q) => compile(rh([q]), { schema }).explain.resultType
    let maybe = "(data.*A.x > 1 & data.*A.x)"
    // a left side that is never missing, or always is, is the only one taken
    expect(typeOf(`first(data.*A.x || "none")`).type).toBe(types.u8)
    expect(typeOf(`sum(data.*A.nope || data.*A.y)`).type).toBe(types.i8)
    expect(typeOf(`{*A: ${maybe} || data.*A.y}`).type.objValue).toBe(types.i16)
    expect(typing.isOptionalField(typeOf(`{*A: ${maybe} || (data.*A.y > 0 & data.*A.y)}`).type)).toBe(true)
    // likewise for a condition
    expect(typeOf(`{*A: ifElse (data.*A.x) (data.*A.x) "none"}`).type.objValue).toBe(types.u8)
    expect(typeOf(`{*A: ifElse (data.*A.nope) (data.*A.x) "none"}`).type.objValue).toBe("none")
    expect(typeOf(`{*A: ifElse (data.*A.x > 1) (data.*A.x) 1000}`).type.objValue).toBe(types.i32)
})

test("length-isUndef-nothing", () => {
    let schema = typing.parseType`{data: {*u32: {x: u8, s: string, m: u8 | string}}}`
    let field = (q) => compile(rh([`{*A: ${q}}`]), { schema }).explain.resultType
    let optional = (q) => typing.isOptionalField(field(q).type)
    // a string or object always has a length; anything else has none
    expect(optional("length(data.*A.s)")).toBe(false)
    expect(optional("length(data.*A.x)")).toBe(true)
    expect(optional("length(data.*A.m)")).toBe(true)
    // isUndef is true exactly when its argument is missing
    expect(field("isUndef(data.*A.nope)").type.objValue).toBe(types.boolean)
    expect(optional("isUndef(data.*A.nope)")).toBe(false)
    expect(field("isUndef(data.*A.x)").type.objValue).toBe(types.never)
    expect(field("isUndef(data.*A.x > 1 & data.*A.x)").type.objValue).toBe(types.boolean)
})

test("optional-field", () => {
    let P = typing.parseType
    let get = (obj, key) => typing.performObjectGet({type: obj, props: []}, {type: key, props: []})
    let opt = P`{a?: u8, b: string}`
    // looking up an optional field may find nothing
    expect(get(opt, "a")).toEqual({type: types.u8, props: [props.nothing]})
    expect(get(opt, "b")).toEqual({type: types.string, props: []})
    // an absent optional field leaves the one it shadows
    let shadow = typing.objBuilder().add("a", types.u8).add("a", types.string, true).build()
    expect(typing.typeEquals(get(shadow, "a").type, typing.createUnion(types.u8, types.string))).toBe(true)
    expect(get(shadow, "a").props).toEqual([])
    // a field that may be absent only fits an optional one
    expect(typing.isSubtype(P`{a: u8, b: string}`, opt)).toBe(true)
    expect(typing.isSubtype(P`{b: string}`, opt)).toBe(true)
    expect(typing.isSubtype(opt, P`{a: u8, b: string}`)).toBe(false)
    expect(typing.isSubtype(P`{}`, P`{a?: u8}`)).toBe(true)
    expect(typing.isSubtype(P`{}`, P`{a: u8}`)).toBe(false)
    expect(typing.sameType(P`{a?: u8}`, P`{a: u8}`)).toBe(false)
    // and merging two objects keeps it
    let merged = typing.createIntersection(P`{a?: u8}`, P`{b: string}`)
    expect(get(merged, "a").props).toEqual([props.nothing])
})

test("optional-field-producers", () => {
    let schema = typing.parseType`{data: {*u32: {x: u8, s: string, k: string}}}`
    let maybe = "data.*A.x > 100 & data.*A.x"
    let fieldOf = (type, key) => {
        for (let obj = type; obj.objParent != null; obj = obj.objParent)
            if (obj.objKey === key) return obj
    }
    // a record field whose value may be missing is optional; the record is
    // always there -- for both encodings of a record
    for (let mkTuple of [false, true]) {
        let res = compile(rh([`{*A: {a: ${maybe}, b: data.*A.s}}`]), {schema, mkTuple}).explain.resultType
        expect(res.props).toEqual([])
        expect(typing.isOptionalField(res.type)).toBe(false)
        expect(typing.isOptionalField(fieldOf(res.type.objValue, "a"))).toBe(true)
        expect(typing.isOptionalField(fieldOf(res.type.objValue, "b"))).toBe(false)
    }
    // an inner group is there even if empty; only its fields are optional
    let nested = compile(rh([`{data.*A.s: {data.*A.k: ${maybe}}}`]), {schema}).explain.resultType
    expect(nested.props).toEqual([])
    expect(typing.isOptionalField(nested.type)).toBe(false)
    expect(typing.isOptionalField(nested.type.objValue)).toBe(true)
    // but a level of a multi-variable key only exists once it holds a value
    let deep = compile(rh`data.*A.*B > 100 & data.*A.*B`,
        {schema: typing.parseType`{data: {*u32: {*string: u8}}}`}).explain.resultType
    expect(deep.props).toEqual([])
    expect(typing.isOptionalField(deep.type)).toBe(true)
    expect(typing.isOptionalField(deep.type.objValue)).toBe(true)
})

test("get-union-non-object", () => {
    let P = typing.parseType
    let typeOf = (q, schema) => compile(rh([q]), { schema }).explain.resultType
    // a number or boolean has no fields: in a union with an object, a lookup
    // on it finds nothing, as at runtime
    expect(typeOf("data.a", P`{data: {a: u8} | u8}`)).toEqual({type: types.u8, props: [props.nothing]})
    expect(typeOf("data.a", P`{data: u8 | boolean | {a: string}}`)).toEqual({type: types.string, props: [props.nothing]})
    // and it has no keys for a variable to range over
    let f = compile(rh`sum(data.*A)`, { schema: P`{data: {*u32: u8} | u8}` })
    expect(f.explain.resultType).toEqual({type: types.u8, props: []})
    expect(f({data: [1, 2]})).toBe(3)
    expect(f({data: 5})).toBe(0)
    // there must be an object to look up in
    expect(() => typeOf("data.a", P`{data: u8}`)).toThrow(/non-object/)
    expect(() => typeOf("data.a", P`{data: u8 | boolean}`)).toThrow(/non-object/)
    // a string is indexed by character in the js backend, so not 'nothing'
    expect(() => typeOf("data.a", P`{data: {a: u8} | string}`)).toThrow(/non-object/)
})

test("all-any-nothing", () => {
    let schema = typing.parseType`{data: {*u32: {b: boolean, x: u8}}, one: {b: boolean}}`
    let propsOf = (q) => compile(rh([q]), { schema }).explain.resultType.props
    // 'all' starts out true: missing exactly when some value is
    expect(propsOf("all(data.*A.b)")).toEqual([])
    expect(propsOf("all(data.*A.x > 3)")).toContain(props.nothing)
    expect(propsOf("all?(data.*A.b)")).toContain(props.nothing) // starts out missing
    // 'any' keeps the first value present, as 'first' does
    expect(propsOf("any(data.*A.b)")).toContain(props.nothing)
    expect(propsOf("any(one.b)")).toEqual([])
    let f = compile(rh`all(data.*A.b)`, { schema })
    expect(f({data: []})).toBe(true)
})

test("and-never-left", () => {
    let schema = typing.parseType`{one: {y: u8}}`
    let typeOf = (q) => compile(rh([q]), { schema }).explain.resultType
    // the right side if the left one is there: never, if it never is
    for (let q of ["one.nope & one.y", "one.nope && one.y", "false & one.y"])
        expect(typeOf(q)).toEqual({type: types.never, props: [props.nothing]})
    expect(typeOf("(one.y > 3) & one.y")).toEqual({type: types.u8, props: [props.nothing]})
    expect(typeOf("one.y & one.y")).toEqual({type: types.u8, props: []})
    // so it drops out of a branch
    expect(typeOf("(false & one.y) || 7").type).toBe(types.i32)
})

test("never-is-nothing", () => {
    // a value of type never cannot exist, so it is always missing
    let schema = typing.parseType`{data: {*string: u8}, other: [u8], rec: {a: never}}`
    let typeOf = (q) => compile(rh([q]), { schema }).explain.resultType
    expect(typeOf("rec.a")).toEqual({type: types.never, props: [props.nothing]})
    expect(typeOf("rec.a & 1")).toEqual({type: types.never, props: [props.nothing]})
    // a variable whose generators share no keys ranges over none
    expect(typing.isOptionalField(typeOf("{*A: data.*A + other.*A}").type)).toBe(true)
})
