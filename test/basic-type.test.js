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
    
    // console.log(func.c2.explain.ir.filters[0])
    // console.log(func.c2.explain.pseudo)
    // in the output, type of data[D0] is shown as {}?

    let res = func({ data, other: data })
    let expected = 60
    expect(res).toBe(expected)
})

test("plusTest1a", () => {
    let query = rh`2 + .arg`
    let func = api.compile(query, {arg: typing.number})
    
    let res = func({ arg: 8 })
    let expected = 10
    expect(res).toBe(expected)
})

test("plusTest1b", () => {
    let query = rh`2 + .arg`
    expect(() => {
        let func = api.compile(query, {arg: typing.string})
        
        let res = func({ arg: "HELLO" })
        let expected = 10
        expect(res).toBe(expected)
    }).toThrow(new Error("Unable to conform arg type of String to (Number | Nothing)"))
})

test("plusTest2a", () => {
    let query = rh`2 + .arg.field`
    let func = api.compile(query, {arg: {field: typing.number}})
    
    let res = func({ arg: { field: 8 }})
    let expected = 10
    expect(res).toBe(expected)
})

test("plusTest2b", () => {
    let query = rh`2 + .arg.field`
    expect(() => {
        let func = api.compile(query, {arg: {field: typing.string}})
    
        let res = func({ arg: { field: "HELLO" }})
        let expected = 10
        expect(res).toBe(expected)
    }).toThrow(new Error("Unable to conform arg type of String to (Number | Nothing)"))
})

test("plusTest2c", () => {
    let query = rh`2 + .arg.field`
    expect(() => {
        let func = api.compile(query, {arg: typing.string})
    
        let res = func({ arg: "HELLO" })
        let expected = 10
        expect(res).toBe(expected)
    }).toThrow(new Error("Error in attempting to access field on type: String"))
})

test("plusTest2d", () => {
    let query = rh`2 + .arg.field`
    // expect(() => {
        let func = api.compile(query, {arg: {field1: typing.number}})
    
        let res = func.c2({ arg: { field1: 8 }})
        let expected = 10
        expect(res).toBe(undefined)
    // TBD: what is the expected behavior? type error?
    // }).toThrow(new Error("Error in attempting to access field on type: String"))
})

test("plusTest2e", () => {
    let query = rh`2 + .arg.field`
    // expect(() => {
        let func = api.compile(query, {arg1: {field: typing.number}})
    
        let res = func.c2({ arg1: { field: 8 }})
        let expected = 10
        expect(res).toBe(undefined)
    // TBD: what is the expected behavior? type error?
    // }).toThrow(new Error("Error in attempting to access field on type: String"))
})

test("plusTest3a", () => {
    let query = rh`2 + .arg.*`
    let func = api.compile(query, {arg: {field: typing.number}})
    
    let res = func.c2({ arg: { field: 8 }})
    let expected = {field: 10}
    expect(res).toEqual(expected)
})

test("plusTest3b", () => {
    let query = rh`2 + .arg.*`
    expect(() => {
        let func = api.compile(query, {arg: {field: typing.string}})
        
        let res = func.c2({ arg: { field: 8 }})
        let expected = {field: 10}
        expect(res).toEqual(expected)
    }).toThrow(new Error("Unable to conform arg type of String to (Number | Nothing)"))
})

test("plusTest4a", () => {
    let query = rh`2 + .*.field`
    let func = api.compile(query, {arg: {field: typing.number}})
    
    let res = func.c2({ arg: { field: 8 }})
    let expected = {arg: 10}
    expect(res).toEqual(expected)
})

test("plusTest4b", () => {
    let query = rh`2 + .*.field`
    expect(() => {
        let func = api.compile(query, {arg: {field: typing.string}})
        
        let res = func.c2({ arg: { field: 8 }})
        let expected = {arg: 10}
        expect(res).toEqual(expected)
    }).toThrow(new Error("Unable to conform arg type of String to (Number | Nothing)"))
})

