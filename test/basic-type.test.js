const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')
const { typing, types, prettyPrintType } = require("../src/typing");

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
];

let key = typing.createKey(types.u8);
let key2 = typing.createKey(types.u8);

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
    let func = api.compile(api.plus(1, -1), types.nothing);
    expect(func.explain2.resultType).toBe(types.i16);
})

test("plainSumTest", () => {
    let query = {"data.*A.key": api.sum("other.*A.value")};
    let func = api.compile(query, typing.createSimpleObject({data: dataSchema, other: otherSchema}));
    //console.log(prettyPrintType(func.explain2.resultType));
    //console.log(prettyPrintType(typing.objBuilder().add(typing.createUnion("A", "B"), types.u8).build()));
    //expect(typing.isSubtype(typing.objBuilder().add(typing.createUnion("A", "B"), types.u8).build(), func.explain2.resultType)).toBe(true);
    //expect(res).toBe(expected)
})
