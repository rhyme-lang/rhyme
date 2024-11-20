const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')
const { typing, types, props } = require("../src/typing");

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
];

let key = typing.createKey(types.u8);

let dataSchema = typing.objBuilder()
    .add(key, typing.createSimpleObject({
        key: typing.createUnion("A", "B"),
        value: types.u8
    }))
    .build();

let otherSchema = typing.objBuilder()
    .add(key, typing.createSimpleObject({
        key: typing.createUnion("A", "B"),
        value: types.u8
    }))
    .build();

test("type-creation-1", () => {
    let type = typing.createUnion(types.u8, types.u16);
    expect(type).toBe(types.u16);
})

test("type-creation-2", () => {
    let type = typing.createUnion(types.u8, types.i16);
    expect(type).toBe(types.i16);
})

test("type-creation-3", () => {
    let func = api.compile(api.plus(1, 63), types.never);
    expect(func.explain2.resultType).toStrictEqual({
        type: types.u8,
        props: new Set([])
    });
})

test("plainSumTest", () => {
    let query = {"data.*A.key": api.sum("other.*A.value")};
    let func = api.compile(query, typing.createSimpleObject({data: dataSchema, other: otherSchema}));
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual(new Set());
    // Must be object keyed by A u B, with values of u8.
    expect(typing.isObject(type)).toBe(true);
    expect(typing.isSubtype(type.objKey, typing.createUnion("A", "B"))).toBe(true);
    expect(type.objValue).toBe(types.u8);
})

test("type-double-generator", () => {
    let query = api.first("other.*A.*B");
    let func = api.compile(query, typing.createSimpleObject({data: dataSchema, other: otherSchema}));
    expect(func.explain2.resultType).toStrictEqual({
        type: typing.createUnion(types.u8, typing.createUnion("A", "B")),
        props: new Set([props.nothing]) // TODO: Add non-empty guarantee to query.
    });
})