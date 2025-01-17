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

  let func = api.compileC2(query)
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

  let func = api.compileC2(query)
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
