const { parse, rh } = require("../../src/parser");
const { prettyType } = require("../../src/prettyprint")
const { typing, types } = require("../../src/typing");

// Types written inline with '@' in a Rhyme query, compared against the same
// types built with the typing helpers. Dynamic keys get fresh symbols, so
// they are compared by printed structure with the symbol names erased.

let show = (type) => prettyType(type).replace(/<Key\d+:/g, "<Key:");

let expectSameType = (actual, expected) => expect(show(actual)).toBe(show(expected));

test("base-types", () => {
    expect(parse("@string").rhyme_ast.xxop).toBe(types.string);
    expect(parse("@i32").rhyme_ast.xxop).toBe(types.i32);
    expect(parse("@\"A\"").rhyme_ast.xxop).toBe("A");
});

test("object", () => {
    expectSameType(parse("@{A: string, B: i32}").rhyme_ast.xxop,
        typing.createSimpleObject({ A: types.string, B: types.i32 }));
});

test("field-names-are-not-types", () => {
    // 'date' is also a type name, but in key position it is a field name
    expectSameType(parse("@{date: string}").rhyme_ast.xxop,
        typing.createSimpleObject({ date: types.string }));
});

test("dynamic-key", () => {
    expectSameType(parse("@{*u32: {A: string, B: i32}}").rhyme_ast.xxop,
        typing.objBuilder()
            .add(typing.createKey(types.u32), typing.createSimpleObject({ A: types.string, B: types.i32 }))
            .build());
});

test("array", () => {
    expectSameType(parse("@[u8]").rhyme_ast.xxop,
        typing.objBuilder().add(typing.createKey(types.u32), types.u8).build());
});

test("union-and-intersection", () => {
    expectSameType(parse("@(string | i32)").rhyme_ast.xxop, typing.createUnion(types.string, types.i32));
    expectSameType(parse("@{a: \"x\" | \"y\"}").rhyme_ast.xxop,
        typing.createSimpleObject({ a: typing.createUnion("x", "y") }));
    expectSameType(parse("@({a: u8} & {b: u8})").rhyme_ast.xxop,
        typing.createIntersection(typing.createSimpleObject({ a: types.u8 }), typing.createSimpleObject({ b: types.u8 })));
});

test("hole", () => {
    let key = typing.createKey(types.u32);
    let type = rh`@{${key}: {a: u8}, ${key}: u16}`.rhyme_ast.xxop;
    // the spliced key object is used as is, so both entries share it
    expect(type.objKey).toBe(key);
    expect(type.objParent.objKey).toBe(key);
});

test("as-load-argument", () => {
    let q = parse(`loadCSV "f.csv" @{*u32: {A: string}}`).rhyme_ast;
    expect(q.xxkey).toBe("apply");
    let [f, file, schema] = q.xxparam;
    expect(f.xxop).toBe("loadCSV");
    expect(file.xxop).toBe("f.csv");
    expect(schema.xxkey).toBe("hole");
    expectSameType(schema.xxop,
        typing.objBuilder()
            .add(typing.createKey(types.u32), typing.createSimpleObject({ A: types.string }))
            .build());
});

test("errors", () => {
    expect(() => parse("@ string")).toThrow("no space allowed after '@'");
    expect(() => parse("@foo")).toThrow("unknown type 'foo'");
    expect(() => parse("@{a: toString}")).toThrow("unknown type 'toString'");
    expect(() => parse("@{*foo: u8}")).toThrow("unknown key type 'foo'");
    expect(() => parse("@[u8, u16]")).toThrow("array type expects one element type");
    expect(() => parse("@(dense u32 2 u32)")).toThrow("unsupported type syntax");
    expect(() => rh`@${{ A: "string" }}`).toThrow("type expected in hole");
});
