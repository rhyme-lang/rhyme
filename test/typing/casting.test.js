const { api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { rh } = require('../../src/parser')
const { typing, types, props, typeSyms } = require("../../src/typing");

let key = typing.createKey(types.string);

let dataSchema = {
    "-": typing.keyval(key, {
        key: typing.createUnion("A", "B"),
        value: types.f64
   })
};

let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
];

test("overflow-basic", () => {
    let data = {
        u8: [0xff, 1],
        u16: [0xffff, 1],
        u32: [0xffffffff, 1],
        u64: [BigInt("0xffffffffffffffff"), 1],
        i8: [0x7f, 1],
        i16: [0x7fff, 1],
        i32: [0x7fffffff, 1],
        i64: [BigInt("0x7fffffffffffffff"), 1],
    };
    let query = {
        u8Overflow: `.u8.* | sum`,
        u16Overflow: `.u16.* | sum`,
        u32Overflow: `.u32.* | sum`,
        u64Overflow: `.u64.("0") + .u64.("1")`,
        i8Overflow: `.i8.* | sum`,
        i16Overflow: `.i16.* | sum`,
        i32Overflow: `.i32.* | sum`,
        i64Overflow: `.i64.("0") + .i64.("1")`,
    };
    let schema = `{
        "u8": {0: u8, 1: u8},
        "u16": {0: u16, 1: u8},
        "u32": {0: u32, 1: u8},
        "u64": {0: u64, 1: u8},
        "i8": {0: i8, 1: i8},
        "i16": {0: i16, 1: u8},
        "i32": {0: i32, 1: u8},
        "i64": {0: i64, 1: u8}
    }`;
    // wrap-around on overflow comes from the inserted convert_<type> nodes
    let func = compile(query, {schema, typeConversions: true});
    let res = func(data);
    expect(res.u8Overflow).toBe(0)
    expect(res.u16Overflow).toBe(0)
    expect(res.u32Overflow).toBe(0)
    expect(res.u64Overflow).toBe(BigInt(0))
    expect(res.i8Overflow).toBe(-0x80)
    expect(res.i16Overflow).toBe(-0x8000)
    expect(res.i32Overflow).toBe(-0x80000000)
    expect(res.i64Overflow).toBe(BigInt(-1) * BigInt("0x8000000000000000"))
})

test("literal-basic", () => {
    // as in C: an integer literal is i32 (i64 if it does not fit), else f64
    let typeOf = (q) => compile(rh([q]), {schema: types.unknown}).explain.resultType.type
    expect(typeOf("0")).toBe(types.i32)
    expect(typeOf("255")).toBe(types.i32)
    expect(typeOf("3000000000")).toBe(types.i64)
    expect(typeOf("2.5")).toBe(types.f64)
    expect(typeOf("100000000000000000000")).toBe(types.f64)
    expect(typeOf("200 + 100")).toBe(types.i32)
    expect(typeOf("0 - 1")).toBe(types.i32)
    expect(typeOf("1.5 + 1")).toBe(types.f64)
    expect(compile(rh`200 + 100`, {schema: types.unknown, typeConversions: true})()).toBe(300)
})

test("join-number", () => {
    expect(typing.joinNumber(types.u32, types.i16)).toBe(types.i64)
    expect(typing.joinNumber(types.u8, types.i8)).toBe(types.i16)
    expect(typing.joinNumber(types.u16, types.i8)).toBe(types.i32)
    expect(typing.joinNumber(types.i32, types.f32)).toBe(types.f64)
    expect(typing.joinNumber(types.u64, types.i8)).toBe(types.f64)
    // two minimal common supertypes, one integer, one float: integer wins
    expect(typing.joinNumber(types.i32, types.u32)).toBe(types.i64)

    let schema = typing.parseType`{data: {*u32: {x: u32, y: i8, z: u8}}}`
    let typeOf = (q) => compile(rh([q]), {schema}).explain.resultType.type
    // a literal takes the type of the operand it is combined with
    expect(typeOf("sum(data.*A.z + 1)")).toBe(types.u8)
    expect(typeOf("sum(data.*A.x + 10)")).toBe(types.u32)
    // a literal that cannot be a value of that type is an error
    expect(() => typeOf("sum(data.*A.z + 300)")).toThrow(/does not fit u8/)
    expect(() => typeOf("data.*A.z == 300")).toThrow(/does not fit u8/)
    // a fractional literal next to an integer keeps f64
    expect(typeOf("sum(data.*A.x * 0.5)")).toBe(types.f64)
    expect(typeOf("sum(data.*A.x + 1.5)")).toBe(types.f64)
    expect(typeOf("sum(data.*A.y || 0)")).toBe(types.i8)
    // fit is by value range, also for signed types and floats
    expect(typeOf("sum(data.*A.y + 127)")).toBe(types.i8)
    expect(() => typeOf("sum(data.*A.y + 128)")).toThrow(/does not fit i8/)
    expect(typeOf("sum(data.*A.x + data.*A.y)")).toBe(types.i64)
    // branches join too, rather than leaving a union for the backend
    expect(typeOf("sum((data.*A.y > 0 & data.*A.y) || data.*A.z)")).toBe(types.i16)
    // a left side that is never missing is the only one taken
    expect(typeOf("sum(data.*A.y || data.*A.z)")).toBe(types.i8)
    // a literal in a branch is not computed with the other side: if it does
    // not fit, the branches join
    expect(typeOf("sum((data.*A.z > 0 & data.*A.z) || 1000)")).toBe(types.i32)
    expect(typeOf("sum((data.*A.z > 0 & data.*A.z) || 7)")).toBe(types.u8)
    // a literal reaching a reducer does not wrap in a narrow type
    let data = Array.from({length: 300}, () => ({x: 1, y: 1, z: 1}))
    expect(compile(rh`sum(data.*A.z && 1)`, {schema, typeConversions: true})({data})).toBe(300)
})

test("overflow-declared-type", () => {
    // arithmetic and sums on declared types wrap around in them
    let schema = typing.parseType`{data: {*u32: {x: u8, y: u32, z: u32}}}`
    let data = [{x: 200, y: 3, z: 4}, {x: 100, y: 5, z: 4}]
    let run = (q) => {
        let f = compile(rh([q]), {schema, typeConversions: true})
        return [f.explain.resultType.type, f({data})]
    }
    expect(run("sum(data.*A.x)")).toEqual([types.u8, 44])
    expect(run("{*A: data.*A.y - data.*A.z}")[1]).toEqual({0: 0xffffffff, 1: 1})
})

test("constant-expression", () => {
    // arithmetic on constants is a constant, exact, as in Go: it takes its
    // type from where it is used, however it is grouped
    let schema = typing.parseType`{data: {*u32: {x: u8, y: i8, f: f32}}}`
    let typeOf = (q) => compile(rh([q]), {schema}).explain.resultType.type
    expect(typeOf("sum(1 + 2 + data.*A.x)")).toBe(types.u8)
    expect(typeOf("sum(data.*A.x + 1 + 2)")).toBe(types.u8)
    expect(typeOf("sum(data.*A.x + (10 - 4))")).toBe(types.u8)
    expect(typeOf("sum(7 // 2 + data.*A.x)")).toBe(types.u8)
    // so it must fit as a whole, and 0 - 1 is a negative constant
    expect(() => typeOf("sum(data.*A.x + (200 + 100))")).toThrow(/300 does not fit u8/)
    expect(() => typeOf("data.*A.x > 0 - 1")).toThrow(/-1 does not fit u8/)
    expect(typeOf("sum(data.*A.y > 0 - 1 & 1)")).toBe(types.i32)
    // '/' is float division, so its constants are floats, even if whole
    expect(typeOf("sum(data.*A.x * (4 / 2))")).toBe(types.f64)
    expect(typeOf("sum(data.*A.f * (1 / 4))")).toBe(types.f32)
    // on its own, a constant is typed by its value, like a literal
    expect(typeOf("2147483647 + 1")).toBe(types.i64)
    expect(typeOf("1 / 2")).toBe(types.f64)
    // and converted once, as the value it denotes
    let data = [{x: 250, y: 1, f: 1}]
    expect(compile(rh`sum(data.*A.x + (10 - 4))`, {schema, typeConversions: true})({data})).toBe(0)
    expect(compile(rh`2147483647 + 1`, {schema, typeConversions: true})({data})).toBe(2147483648)
})
