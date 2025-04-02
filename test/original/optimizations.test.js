const { api, rh } = require('../../src/rhyme')
const { typing, types } = require('../../src/typing')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

let key = typing.createKey(types.string);

let dataSchema = {
    "-": typing.keyval(key, {
        key: typing.createUnion("A", "B"),
        value: types.u16
   })
};

let countryData = [
    { region: "Asia", country: "Japan", city: "Tokyo", population: 30 },
    { region: "Asia", country: "China", city: "Beijing", population: 20 },
    { region: "Europe", country: "France", city: "Paris", population: 10 },
    { region: "Europe", country: "UK", city: "London", population: 10 },
]

let regionData = [
    { region: "Asia", country: "Japan" },
    { region: "Asia", country: "China" },
    { region: "Europe", country: "France" },
    { region: "Europe", country: "UK" },
]

let key2 = typing.createKey(types.string);

let countrySchema = {
    "-": typing.keyval(key2, {
        region: types.string,
        country: types.string,
        city: types.string,
        population: types.u8
    })
};

let regionSchema = {
    "-": typing.keyval(key2, {
        region: types.string,
        country: types.string,
    })
};

test("constant-folding-plus", () => {
    let query = rh`1 + 2`;
    let func = api.compile(query, typing.parseType({data: dataSchema}))
    let res = func({ data })
    let expected = 3
    expect(res).toBe(expected)
})

test("constant-folding-eta-reduction", () => {
    let query = {"total": rh`data.*A.value | sum`};
    let func = api.compile(rh`${query}.total`, typing.parseType({data: dataSchema}))
    console.log(func.explain2.pseudo);
    let res = func({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("constant-fold", () => {
    let func1 = api.compileC2("sum 1", typing.parseType({data: dataSchema}))
    let func2 = api.compileC2("count 1", typing.parseType({data: dataSchema}))
    let func3 = api.compileC2("1 + 2", typing.parseType({data: dataSchema}))
    let func4 = api.compileC2("1 & 2", typing.parseType({data: dataSchema}))
    let func5 = api.compileC2("1 || 2", typing.parseType({data: dataSchema}))
    let func6 = api.compileC2(rh`(1 == 2) || 1`, typing.parseType({data: dataSchema}))

    expect(func1.explain2.pseudo.includes("sum")).toBe(false);
    expect(func2.explain2.pseudo.includes("count")).toBe(false);
    expect(func3.explain2.pseudo.includes("plus")).toBe(false);
    expect(func4.explain2.pseudo.includes("and")).toBe(false);
    expect(func5.explain2.pseudo.includes("orElse")).toBe(false);
    expect(func6.explain2.pseudo.includes("orElse")).toBe(false);
    expect(func6.explain2.pseudo.includes("equals")).toBe(false);

    expect(func1({data})).toStrictEqual(1);
    expect(func2({data})).toStrictEqual(1);
    expect(func3({data})).toStrictEqual(3);
    expect(func4({data})).toStrictEqual(2);
    expect(func5({data})).toStrictEqual(1);
    expect(func6({data})).toStrictEqual(1);
})

test("string-replacement", () => {
    let func1 = api.compileC2(rh`single data.*A.key`, typing.parseType`{data: {*u8: {key: "A"}}}`)
    let func2 = api.compileC2(rh`single (data.*A.key :: "B")`, typing.parseType`{data: {*u8: {key: "A"}}}`)

    expect(func1.explain2.pseudo.includes("[key]")).toBe(false);
    expect(func1.explain2.pseudo.includes("single")).toBe(false);
    expect(func2.explain2.pseudo.includes("[key]")).toBe(false);
    expect(func2.explain2.pseudo.includes("single")).toBe(false);

    expect(func1({data: {0: {key: "A"}}})).toStrictEqual("A");
    expect(func2({data: {0: {key: "A"}}})).toStrictEqual("AB");
})

test("value-irrelevance", () => {
    // When types are known, optimize out known values fully. Note: The generators and free variables of the expression still stay.
    let func1 = api.compileC2("count (data.*A.value + 1)", typing.parseType({data: dataSchema}))
    let func2 = api.compileC2("(1 + data.*A.value) & 1", typing.parseType({data: dataSchema}))

    expect(func1.explain2.pseudo.includes("plus")).toBe(false);
    expect(func1.explain2.pseudo.includes("[value]")).toBe(false);
    expect(func2.explain2.pseudo.includes("plus")).toBe(false);
    expect(func2.explain2.pseudo.includes("[value]")).toBe(false);

    // When types are unknown, validate necessary properties, without running unnecessary calculations.
    let func3 = api.compileC2("(1 + data.*A.value) & 1", typing.parseType({data: types.unknown}))
    expect(func3.explain2.pseudo.includes("plus")).toBe(false);
    expect(func3.explain2.pseudo.includes("[value]")).toBe(true);

    expect(func1({data})).toStrictEqual(3);
    expect(func2({data})).toStrictEqual({0: 1, 1: 1, 2: 1});
    expect(func3({data})).toStrictEqual({0: 1, 1: 1, 2: 1});
})

test("dead-code-elim", () => {
    let func1 = api.compileC2("(data.*A.key) & (sum data.*A.value)", typing.parseType({data: dataSchema}))
    let func2 = api.compileC2("(sum data.*A.value) || (data.*A.key)", typing.parseType({data: dataSchema}))
    let func3 = api.compileC2("(sum data.*A.value) & (data.*A.key)", typing.parseType({data: dataSchema}))

    // Validate that it doesn't attempt to access "data.*A.key"
    expect(func1.explain2.pseudo.includes("[key]")).toBe(false);
    expect(func1.explain2.pseudo.includes("and")).toBe(false);
    expect(func2.explain2.pseudo.includes("[key]")).toBe(false);
    expect(func3.explain2.pseudo.includes("sum")).toBe(false);

    expect(func1({data})).toStrictEqual({0: 10, 1: 20, 2: 30});
    expect(func2({data})).toStrictEqual({0: 10, 1: 20, 2: 30});
    expect(func3({data})).toStrictEqual({0: "A", 1: "B", 2: "A"});
})

test("aggregator-folding", () => {
    // If an aggregator has no bound variables, optimize it out.
    // For sum, this means unwrapping the argument.
    let func1 = api.compileC2("sum (sum data.*A.value)", typing.parseType({data: dataSchema}))
    // For count, this means simply returning a constant of 1.
    let func2 = api.compileC2("count (sum data.*A.value)", typing.parseType({data: dataSchema}))

    expect(func1.explain2.pseudo.match(/sum/g).length).toBe(1);
    expect(func2.explain2.pseudo.includes("sum")).toBe(false);
    expect(func2.explain2.pseudo.includes("1")).toBe(true);

    expect(func1({data})).toBe(60);
    expect(func2({data})).toBe(1);
})

test("loop-consolidation", () => {
    // Validate that loops are consolidated
    let func1 = api.compileC2("sum(data.*A.value) + sum(data.*B.value)", typing.parseType({data: dataSchema}))
    expect( // Check that one of the loops (*A or *B) is removed
        func1.explain2.pseudo.match(/\\*B/g) === null || func1.explain2.pseudo.match(/[*]A/g) === null
    ).toBe(true);

    // Validate that when two objects have the same domain, the loops are consolidated.
    let func2 = api.compileC2("sum(data.*A) + sum(other.*B)", typing.parseType(`{ data: { *u8=A: u8 }, other: { *A: u8 } }`));
    expect( // Check that one of the loops (*A or *B) is removed
        func2.explain2.pseudo.match(/\\*B/g) === null || func2.explain2.pseudo.match(/[*]A/g) === null
    ).toBe(true);

    let func3 = api.compileC2("sum(data.*A.value + data.*B.value)", typing.parseType({data: dataSchema}));
    console.log(func3.explain2.pseudo);
    expect( // Check that both of the loops still exist
        func3.explain2.pseudo.match(/\\*B/g) !== null && func3.explain2.pseudo.match(/[*]A/g) !== null
    ).toBe(true);

    expect(func1({data})).toBe(120);
    expect(func2({data: [10, 20], other: [30, 40]})).toBe(100);
    expect(func3({data})).toBe(360);
})