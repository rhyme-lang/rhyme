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
        value: types.u8
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
    let res = func({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("", () => {
    let query = rh`${1} | sum`;
    let func = api.compile(query, typing.parseType({data: dataSchema}))
    let res = func({ data })
    let expected = 1
    expect(res).toBe(expected)
})