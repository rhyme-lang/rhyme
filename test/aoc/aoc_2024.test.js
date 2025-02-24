/*
 * Implementations of (some) "Advent of Code" challenges 2024
 *
 * Problem statements: https://adventofcode.com
 *
 * Solutions are inspired by existing solutions in:
 * - JQ: https://github.com/odnoletkov/advent-of-code-jq
 * - Scala: https://scalacenter.github.io/scala-advent-of-code
 * - SQL: http://databasearchitects.blogspot.com/2024/12/advent-of-code-2024-in-pure-sql.html
 *
 */


const { api, rh } = require('../../src/rhyme')
const { typing } = require('../../src/typing')

let udf_stdlib = {
  split: d => s => s.split(d),
  toNum: x => (n => Number.isNaN(n) ? undefined : n)(Number(x)),
  isGreaterThan: (x,y) => x > y,
  isGreaterOrEqual: (x,y) => x >= y,
  isLessThan: (x,y) => x < y,
  isLessOrEqual: (x,y) => x <= y,
  isEqual: (x,y) => x === y,
  notEqual: (x,y) => x !== y,
  exp: n => x => n ** x,
  sqrt: n => Math.sqrt(n),
  floor: x => Math.floor(x),
  ceil: x => Math.ceil(x),
  abs: x=> Math.abs(x),
  modulo: (x,y) => x % y,
  int2Char: x => String.fromCharCode(x),
  matchAll: (regex, flags) => x => [...x.matchAll(new RegExp(regex, flags))],
  logicalAnd: (x,y) => x && y,
  logicalOr: (x,y) => x || y,
  range: (start, stop, step) =>
      Array.from({ length: (stop - start + step - 1) / step }, (_, i) => start + (i * step)),
  slice: start => x => x.slice(start),
  join: delim => array => array.join(delim),
  sort: cmpFn => array => array.sort(cmpFn),
  values: o => Object.values(o),
  ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
}

let udf_std_typ = typing.parseType`{
  split: (string) => (string) => [string],
  toNum: (any) => f64,
  isGreaterThan: (f64, f64) => boolean,
  isGreaterOrEqual: (f64, f64) => boolean,
  isLessThan: (f64, f64) => boolean,
  isLessOrEqual: (f64, f64) => boolean,
  isEqual: (any, any) => boolean,
  notEqual: (any, any) => boolean,
  exp: (f64) => (f64) => f64,
  sqrt: (f64) => f64,
  floor: (f64) => f64,
  ceil: (f64) => f64,
  abs: (f64) => f64,
  modulo: (f64) => f64,
  int2Char: (f64) => string,
  matchAll: (string, string) => (string) => [[string]],
  logicalAnd: (boolean, boolean) => boolean,
  logicalOr: (boolean, boolean) => boolean,
  range: (u32, u32, u32) => [u32]
}`;

test("day1-part1", () => {
  let input =
`3   4
4   3
2   5
1   3
3   9
3   3`

  let udf = {
    ...udf_stdlib,
    sort: array => [...array].sort(),
  }

  let pairs = rh`.input | udf.split "\\n" | .* | udf.split "   "`
  let left  = rh`${pairs}.0 | udf.toNum | array | udf.sort`
  let right = rh`${pairs}.1 | udf.toNum | array | udf.sort`
  let query   = rh`${left}.*i - ${right}.*i | udf.abs | sum`

  let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_std_typ} & {sort: (any) => {*u16: i16}}}`)
  let res = func({input, udf})
  expect(res).toBe(11)
})

test("day1-part2", () => {
  let input =
`3   4
4   3
2   5
1   3
3   9
3   3`

  let udf = {
    ...udf_stdlib,
  }

  let pairs = rh`.input | udf.split "\\n" | .* | udf.split "   "`
  let left  = rh`${pairs}.0 | udf.toNum | array | .*`
  let right = rh`${pairs}.1 | udf.toNum`

  let histogram = rh`count ${right} | group ${right}`

  let query   = rh`${left} * ${histogram}.${left} | sum`

  let func = api.compileC2(query, typing.parseType`{input: string, udf: ${udf_std_typ}}`)
  let res = func({input, udf})
  expect(res).toBe(31)
})

test("day2-part1", () => {

  let input =
`7 6 4 2 1
1 2 7 8 9
9 7 6 2 1
1 3 2 4 5
8 6 4 4 1
1 3 6 7 9`

  let udf = {
    ...udf_stdlib,
    slice: a => array => array.slice(a),
    range: (a,b) => { let res = {}; for (let i = a; i < b; i++) res[i] = true; return res },
    orElse: (a,b) => (a || b) || undefined
  }

  let line = rh`.input | udf.split "\\n" | .*line`
  let report = rh`${line} | udf.split " " | .*col | udf.toNum | array`
  let tail = rh`${report} | udf.slice 1`

  let delta = rh`${tail}.*i - ${report}.*i`

  let monotonic = sign => rh`all (udf.range 1 4).(${sign} * ${delta})`
  let safe = rh`udf.orElse ${monotonic(1)} ${monotonic(-1)}`

  let query   = rh`count (*line & ${safe})`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(2)
})


test("day3-part1", () => {

  let input = `xmul(2,4)%&mul[3,7]!@^do_not_mul(5,5)+mul(32,64]then(mul(11,8)mul(8,5))`

  let udf = {
    ...udf_stdlib,
    slice: a => array => array.slice(a),
    range: (a,b) => { let res = {}; for (let i = a; i < b; i++) res[i] = true; return res },
    orElse: (a,b) => (a || b) || undefined
  }

  let matches = rh`.input | udf.matchAll "mul\\\\((\\\\d{1,3}),(\\\\d{1,3})\\\\)" "g" | .*matchIndex`
  let num1 = rh`${matches} | .1 | udf.toNum`;
  let num2 = rh`${matches} | .2 | udf.toNum`;
  let mults = rh`${num1} * ${num2}`;

  let query = rh`sum ${mults}`

  let func = api.compileC2(query);
  let res = func({input, udf})
  //console.log(res);
  expect(res).toBe(161)
})


/*
test("day4-part1", () => {

  let input = `MMMSXXMASM
  MSAMXMSMSA
  AMXSXMAAMM
  MSAMASMSMX
  XMASAMXAMM
  XXAMMXXAMA
  SMSMSASXSS
  SAXAMASAAA
  MAMMMXMMMM
  MXMXAXMASX`;

  let udf = {
    ...udf_stdlib,
    slice: a => array => array.slice(a),
    range: (a,b) => { let res = {}; for (let i = a; i < b; i++) res[i] = true; return res },
    orElse: (a,b) => (a || b) || undefined,
    filter: c => c ? { [c]: true } : {},
  }
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`;

  let line = rh`.input | udf.split "\\n" | .*line`;
  let col = rh`${line} | udf.split "" | .*col`;

  let grid = rh`${col} | group *col | group *line`;

  let diagNames = rh`${grid}.*a.*b + ${grid}.(*a + 1).(*b + 1) + ${grid}.(*a + 2).(*b + 2) + ${grid}.(*a + 3).(*b + 3)`;
  let diagNames2 = rh`${grid}.*a.*b + ${grid}.(*a).(*b - 1) + ${grid}.(*a).(*b - 2) + ${grid}.(*a).(*b - 3)`;

  let count = rh`${filterBy("*f", rh`udf.isEqual ${diagNames2}.*val "XMAS"`)} | count`

  let func = api.compileC2(count);
  let res = func({input, udf})
})
*/

