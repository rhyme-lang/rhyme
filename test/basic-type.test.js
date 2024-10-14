const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')
const { typing } = require("../src/typing");

const { runtime } = require('../src/simple-runtime')
let rt = runtime



// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

let sym = Symbol("*")
let dataSchema = {
    [Symbol("*A")]: {
        key: typing.string,
        value: typing.number
    }
};
let otherSchema = {
    [Symbol("*B")]: {
        key: typing.string,
        value: typing.number
    }
};

test("plainSumTest", () => {
    let query = api.sum("data.*.value");
    let func = api.compile(query, {item: typing.number, data: dataSchema, other: otherSchema});
    let res = func({ data, other: data })
    let expected = 60
    expect(res).toBe(expected)
})
