const { api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { rh } = require('../../src/parser')
const { typing, types, props, typeSyms } = require("../../src/typing");

let dataSchema = typing.parseType`[{
    key: A | B,
    value: f64
}]!`;

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
    let func = compile(query, {schema});
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