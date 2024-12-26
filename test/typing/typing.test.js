const { typing, types } = require("../../src/typing");

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



