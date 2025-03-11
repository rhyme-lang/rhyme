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
  }

  let line = rh`.input | udf.split "\\n" | .*line`
  let report = rh`${line} | udf.split " " | .*col | udf.toNum | array`
  let tail = rh`${report} | udf.slice 1`

  let delta = rh`${tail}.*i - ${report}.*i`

  let monotonic = sign => rh`all (udf.range 1 4).(${sign} * ${delta})`
  let safe = rh`${monotonic(1)} || ${monotonic(-1)}`

  let query   = rh`count (*line & ${safe})`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(2)
})

test("day2-part2", () => {

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
    splice: a => array => array.slice(0, a).concat(array.slice(a+1)),
    range: (a,b) => { let res = {}; for (let i = a; i < b; i++) res[i] = true; return res },
  }

  let line = rh`.input | udf.split "\\n" | .*line`
  let originalReport = rh`${line} | udf.split " " | .*col | udf.toNum | array`
  let dampenedReports = rh`${originalReport}.*cols & (${originalReport} | udf.splice (udf.toNum *cols))`
  let reports = rh`[${originalReport}, ${dampenedReports}] | .*report`
  let tail = rh`${reports} | udf.slice 1`
  let delta = rh`${tail}.*i - ${reports}.*i`
  let monotonic = sign => rh`all (udf.range 1 4).(${sign} * ${delta})`
  let safe = rh`${monotonic(1)} || ${monotonic(-1)} | group *report`
  let query = rh`count (*line & count?(${safe}.*A))`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(4)
})

test("day3-part1", () => {
  
  let input =
`xmul(2,4)%&mul[3,7]!@^do_not_mul(5,5)+mul(32,64]then(mul(11,8)mul(8,5))`

  let udf = {
    ...udf_stdlib,
  }

  let match = rh`.input | udf.matchAll "mul\\\\((\\\\d{1,3}),(\\\\d{1,3})\\\\)" "g" | .*match`
  let first = rh`${match}.1 | udf.toNum`
  let second = rh`${match}.2 | udf.toNum`
  let mul = rh`${first} * ${second}`
  let query   = rh`sum ${mul}`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(161)
})

test("day3-part2", () => {
  
  let input =
`xmul(2,4)&mul[3,7]!^don't()_mul(5,5)+mul(32,64](mul(11,8)undo()?mul(8,5))`

  let udf = {
    reduce: array => array.reduce(([flag, sum], elem) => {
      if (elem[0] === "don't()") return [false, sum]
      else if (elem[0] === "do()") return [true, sum]
      else if (flag === true) return [flag, sum + elem[2] * elem[3]]
      else return [flag, sum]
    }, [true, 0])[1],
    ...udf_stdlib,
  }

  let match = rh`.input | udf.matchAll "(mul\\\\((\\\\d{1,3}),(\\\\d{1,3})\\\\)|do\\\\(\\\\)|don't\\\\(\\\\))" "g"`
  let query   = rh`udf.reduce ${match}`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(48)
})

test("day4-part1", () => {
  
  let input =
`MMMSXXMASM
MSAMXMSMSA
AMXSXMAAMM
MSAMASMSMX
XMASAMXAMM
XXAMMXXAMA
SMSMSASXSS
SAXAMASAAA
MAMMMXMMMM
MXMXAXMASX`

  let delta = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let line = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(line)

  let substring = rh`${grid}.*x.*y :: ${grid}.(*x + ${delta}.*d.0).(*y + ${delta}.*d.1) ::
    ${grid}.(*x + 2 * ${delta}.*d.0).(*y + 2 * ${delta}.*d.1) :: ${grid}.(*x + 3 * ${delta}.*d.0).(*y + 3 * ${delta}.*d.1)`
  let isXMAS = rh`${substring} == "XMAS"`
  let query = rh`${substring} | ${filterBy("*f0", isXMAS)} | count`
  
  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(18)
})

test("day4-part2", () => {
  
  let input =
`MMMSXXMASM
MSAMXMSMSA
AMXSXMAAMM
MSAMASMSMX
XMASAMXAMM
XXAMMXXAMA
SMSMSASXSS
SAXAMASAAA
MAMMMXMMMM
MXMXAXMASX`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let line = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(line)

  let substring1 = rh`${grid}.(*x - 1).(*y - 1) :: ${grid}.*x.*y :: ${grid}.(*x + 1).(*y + 1)`
  let substring2 = rh`${grid}.(*x - 1).(*y + 1) :: ${grid}.*x.*y :: ${grid}.(*x + 1).(*y - 1)`
  let isMAS1 = rh`(${substring1} == "MAS") || (${substring1} == "SAM")`
  let isMAS2 = rh`(${substring2} == "MAS") || (${substring2} == "SAM")`
  let isXMAS = rh`${isMAS1} & ${isMAS2}`
  let query = rh`${substring1} | ${filterBy("*f0", isXMAS)} | count`
  
  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(9)
})

test("day5-part1", () => {
  
  let input =
`47|53
97|13
97|61
97|47
75|29
61|13
75|53
29|13
97|29
53|29
61|53
97|53
61|29
47|13
75|47
97|75
47|61
75|61
47|29
75|13
53|13

75,47,61,53,29
97,61,53,29,13
75,29,13
75,97,47,61,53
61,13,29
97,13,75,29,47`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    arrMid: (arr) => arr[Math.floor(arr.length / 2)],
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  
  let splitInput = rh`.input | udf.split "\\n\\n"`
  let updatesStr = rh`${splitInput}.1`
  let line = rh`${updatesStr} | udf.split "\\n" | .*line`
  let update = rh`${line} | udf.split "," | .*col | udf.toNum | array`
  let arr = rh`(udf.toNum(*x) < udf.toNum(*y)) & {a:${update}.*x, b:${update}.*y}`

  let rulesStr = rh`${splitInput}.0`
  let rule = rh`${rulesStr} | udf.matchAll "(\\\\d+)\\\\|(\\\\d+)" "g" | .*rule | udf.slice 1 | .*rulecol | udf.toNum | group *rulecol | array`
  let rulesViolated = rh`(${rule}.*i.0 == ${arr}.b) & (${rule}.*i.1 == ${arr}.a)`
  let countViolations = rh`${rulesViolated} | count`
  let isValid = rh`${countViolations} == 0`
  
  let mid = rh`udf.arrMid ${update}`
  let query = rh`sum(*line & (${mid} | ${filterBy("*f0", isValid)}))`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(143)
})

test("day5-part2", () => {
  
  let input =
`47|53
97|13
97|61
97|47
75|29
61|13
75|53
29|13
97|29
53|29
61|53
97|53
61|29
47|13
75|47
97|75
47|61
75|61
47|29
75|13
53|13

75,47,61,53,29
97,61,53,29,13
75,29,13
75,97,47,61,53
61,13,29
97,13,75,29,47`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    arrMid: (arr) => arr[Math.floor(arr.length / 2)],
    slice: a => array => array.slice(a),
    customSort: (rules, arr) => {
      return arr.sort((a, b) => rules.some(pair => pair[0] === b && pair[1] === a) ? 1 : -1)
    },
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  
  let splitInput = rh`.input | udf.split "\\n\\n"`
  let updatesStr = rh`${splitInput}.1`
  let line = rh`${updatesStr} | udf.split "\\n" | .*line`
  let update = rh`${line} | udf.split "," | .*col | udf.toNum | array`
  let arr = rh`(udf.toNum(*x) < udf.toNum(*y)) & {a:${update}.*x, b:${update}.*y}`

  let rulesStr = rh`${splitInput}.0`
  let rule = rh`${rulesStr} | udf.matchAll "(\\\\d+)\\\\|(\\\\d+)" "g" | .*rule | udf.slice 1 | .*rulecol | udf.toNum | group *rulecol | array`
  let rulesViolated = rh`(${rule}.*i.0 == ${arr}.b) & (${rule}.*i.1 == ${arr}.a)`
  let countViolations = rh`${rulesViolated} | count`
  let notValid = rh`${countViolations} != 0`
  
  let invalidUpdate = rh`${update} | ${filterBy("*f0", notValid)}`
  let sortedUpdate = rh`udf.customSort ${rule} ${invalidUpdate}`
  let query = rh`sum(*line & (udf.arrMid ${sortedUpdate}))`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(123)
})

test("day6-part1", () => {
  let input =
`....#.....
.........#
..........
..#.......
.......#..
..........
.#..^.....
........#.
#.........
......#...`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0, 0], [0, 1, 1], [1, 0, 2], [0, -1, 3]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isStart = rh`${grid}.*i.*j == "^"`
  let startPos = rh`[(udf.toNum *i), (udf.toNum *j), 0] | ${filterBy("*f0", isStart)} | single`

  let initialState = {
    curr: startPos,
    grid: grid,
    isBound: false
  }
  let getInitialState = api.compileC2(initialState)
  let state = getInitialState({input, udf})

  let moveCoord = rh`[state.curr.0 + ${delta}.(state.curr.2).0, state.curr.1 + ${delta}.(state.curr.2).1, ${delta}.(state.curr.2).2]`
  let turnDir = rh`(state.curr.2 + 1) % 4`
  let turnCoord = rh`[state.curr.0 + ${delta}.${turnDir}.0, state.curr.1 + ${delta}.${turnDir}.1, ${delta}.${turnDir}.2]`
  let nextCoord = rh`ifElse (state.grid.(${moveCoord}.0).(${moveCoord}.1) == "#") ${turnCoord} ${moveCoord}`
  let rowlen = rh`(${lines} | count | udf.toNum) - 1`
  let collen = rh`(${lines}.*0 | count | group *line | .0 | udf.toNum) - 1`
  let isBound = rh`${nextCoord}.0 == ${rowlen} || ${nextCoord}.0 == 0 || ${nextCoord}.1 == ${collen} || ${nextCoord}.1 == 0`
  let query = {
    curr: nextCoord,
    grid: rh`(update_inplace state.grid.(${nextCoord}.0) (${nextCoord}.1) "^") & state.grid`,
    isBound: isBound
  }
  let func = api.compileC2(query, null)
  while(!state.isBound)
    state = func({input, udf, state})

  let count = rh`state.grid.*x.*y | ${filterBy("*f1", `state.grid.*x.*y == "^"`)} | count`
  let func2 = api.compileC2(count)
  let res = func2({state, udf})
  expect(res).toBe(41)
})

test("day6-part2", () => {
  let input =
`....#.....
.........#
..........
..#.......
.......#..
..........
.#..^.....
........#.
#.........
......#...`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0, 0], [0, 1, 1], [1, 0, 2], [0, -1, 3]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isStart = rh`${grid}.*i.*j == "^"`
  let startPos = rh`[(udf.toNum *i), (udf.toNum *j), 0] | ${filterBy("*f0", isStart)} | single`
  let isEmpty = rh`${grid}.*i.*j == "."`
  let emptyPos = rh`[(udf.toNum *i), (udf.toNum *j)] | ${filterBy("*", isEmpty)} | array`
  let getEmptyPos = api.compileC2(emptyPos)
  let emptyPoses = getEmptyPos({input, udf})
  let initialState = {
    curr: startPos,
    grid: grid,
    isBound: false,
    isLoop: false,
    steps: 0
  }
  let getInitialState = api.compileC2(initialState)

  let res = 0
  let moveCoord = rh`[state.curr.0 + ${delta}.(state.curr.2).0, state.curr.1 + ${delta}.(state.curr.2).1, ${delta}.(state.curr.2).2]`
  let turnDir = rh`(state.curr.2 + 1) % 4`
  let turnCoord = rh`[state.curr.0 + ${delta}.${turnDir}.0, state.curr.1 + ${delta}.${turnDir}.1, ${delta}.${turnDir}.2]`
  let nextCoord = rh`ifElse (state.grid.(${moveCoord}.0).(${moveCoord}.1) == "#") ${turnCoord} ${moveCoord}`
  let rowlen = rh`(${lines} | count | udf.toNum) - 1`
  let collen = rh`(${lines}.*0 | count | group *line | .0 | udf.toNum) - 1`
  let isBound = rh`${nextCoord}.0 == ${rowlen} || ${nextCoord}.0 == 0 || ${nextCoord}.1 == ${collen} || ${nextCoord}.1 == 0`
  let isLoop = rh`state.steps > (${rowlen} + 1) * (${collen} + 1)`
  let query = {
    curr: nextCoord,
    grid: rh`(update_inplace state.grid.(${nextCoord}.0) (${nextCoord}.1) "^") & state.grid`,
    isBound: isBound,
    isLoop: isLoop,
    steps: rh`state.steps + 1`
  }
  let func = api.compileC2(query, null)

  emptyPoses.forEach((coord, _) => {
    let state = getInitialState({input, udf})
    state.grid[coord[0]][coord[1]] = "#"
    while(!state.isBound && !state.isLoop)
      state = func({input, udf, state})
    if (state.isLoop)
      res = res + 1
  })
  expect(res).toBe(6)
})

test("day7-part1", () => {
  let input =
`190: 10 19
3267: 81 40 27
83: 17 5
156: 15 6
7290: 6 8 6 15
161011: 16 10 13
192: 17 8 14
21037: 9 7 18 13
292: 11 6 16 20`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    slice: a => array => array.slice(a),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let line = rh`.input | udf.split "\\n" | .*line`
  let goal = rh`${line} | udf.split ":" | .0 | udf.toNum | group *line`
  let nums = rh`${line} | udf.split ":" | .1 | udf.split " " | .*col | udf.toNum | array | udf.slice 1 | group *line`
  let inputs = {
    nums: nums,
    goal: goal
  }
  let getInputs = api.compileC2(inputs)
  let inputState = getInputs({input, udf})

  let initialState = {
    curr: rh`.elems | udf.slice 1`,
    evaluates: rh`[.elems[0]]`,
  }
  let getInitialState = api.compileC2(initialState)

  let plus = rh`state.evaluates.*e + state.curr.0`
  let mult = rh`state.evaluates.*e * state.curr.0`
  let query = {
    curr: rh`state.curr | udf.slice 1`,
    evaluates: rh`[${plus}, ${mult}]`,
  }
  let func = api.compileC2(query)

  let isGoal = rh`state.evaluates.*e == ${inputState}.goal[.index]`
  let searchGoal = rh`state.evaluates.*e | ${filterBy("*f1", isGoal)} | single`
  let goalOrZero = rh`${searchGoal} || 0`
  let getRowRes = api.compileC2(goalOrZero)

  let res = 0
  Object.values(inputState.nums).forEach((elems, index) => {
    let state = getInitialState({input, udf, elems})
    while (state.curr.length > 0)
      state = func({input, udf, state})
    let rowRes = getRowRes({input, udf, state, index})
    res = res + rowRes
  })
  expect(res).toBe(3749)
})

test("day7-part2", () => {
  let input =
`190: 10 19
3267: 81 40 27
83: 17 5
156: 15 6
7290: 6 8 6 15
161011: 16 10 13
192: 17 8 14
21037: 9 7 18 13
292: 11 6 16 20`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    slice: a => array => array.slice(a),
    concateNums: (a, b) => String(a) + String(b),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let line = rh`.input | udf.split "\\n" | .*line`
  let goal = rh`${line} | udf.split ":" | .0 | udf.toNum | group *line`
  let nums = rh`${line} | udf.split ":" | .1 | udf.split " " | .*col | udf.toNum | array | udf.slice 1 | group *line`
  let inputs = {
    nums: nums,
    goal: goal
  }
  let getInputs = api.compileC2(inputs)
  let inputState = getInputs({input, udf})

  let initialState = {
    curr: rh`.elems | udf.slice 1`,
    evaluates: rh`[.elems[0]]`,
  }
  let getInitialState = api.compileC2(initialState)

  let plus = rh`state.evaluates.*e + state.curr.0`
  let mult = rh`state.evaluates.*e * state.curr.0`
  let concate = rh`udf.concateNums state.evaluates.*e state.curr.0 | udf.toNum`
  let query = {
    curr: rh`state.curr | udf.slice 1`,
    evaluates: rh`[${plus}, ${mult}, ${concate}]`,
  }
  let func = api.compileC2(query)

  let isGoal = rh`state.evaluates.*e == ${inputState}.goal[.index]`
  let searchGoal = rh`state.evaluates.*e | ${filterBy("*f1", isGoal)} | single`
  let goalOrZero = rh`${searchGoal} || 0`
  let getRowRes = api.compileC2(goalOrZero)

  let res = 0
  Object.values(inputState.nums).forEach((elems, index) => {
    let state = getInitialState({input, udf, elems})
    while (state.curr.length > 0)
      state = func({input, udf, state})
    let rowRes = getRowRes({input, udf, state, index})
    res = res + rowRes
  })
  expect(res).toBe(11387)
})

test("day8-part1", () => {
  let input =
`............
........0...
.....0......
.......0....
....0.......
......A.....
............
............
........A...
.........A..
............
............`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    toSet: (arr) => arr.filter((value, index, self) =>
      index === self.findIndex(t => t.node1 === value.node1 && t.node2 === value.node2)
    ),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isAntennas = rh`${grid}.*i.*j != "."`
  let allAntennas = rh`[(udf.toNum *i), (udf.toNum *j)] | ${filterBy("*f0", isAntennas)} | array`

  let allAntennaPair = rh`udf.toNum(*x) < udf.toNum(*y) & {a:${allAntennas}.*x, b:${allAntennas}.*y}`
  let isPair = rh`${grid}.(${allAntennaPair}.a.0).(${allAntennaPair}.a.1) == ${grid}.(${allAntennaPair}.b.0).(${allAntennaPair}.b.1)`
  let antennaPairs = rh`${allAntennaPair} | ${filterBy("*f1", isPair)}`
  let antinode1 = rh`{node1:(${antennaPairs}.a.0 + ${antennaPairs}.a.0 - ${antennaPairs}.b.0), node2:(${antennaPairs}.a.1 + ${antennaPairs}.a.1 - ${antennaPairs}.b.1)}`
  let antinode2 = rh`{node1:(${antennaPairs}.b.0 + ${antennaPairs}.b.0 - ${antennaPairs}.a.0), node2:(${antennaPairs}.b.1 + ${antennaPairs}.b.1 - ${antennaPairs}.a.1)}`
  let antinode = rh`[${antinode1}, ${antinode2}] | udf.toSet`

  let rowlen = rh`(${lines} | count | udf.toNum) - 1`
  let collen = rh`(${lines}.*0 | count | group *line | .0 | udf.toNum) - 1`
  let inBound = rh`${rowlen} >= ${antinode}.*node.node1 & 0 <= ${antinode}.*node.node1 & ${collen} >= ${antinode}.*node.node2 & 0 <= ${antinode}.*node.node2`
  let query = rh`${antinode}.*node | ${filterBy("*f2", inBound)} | count`

  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(14)
})

test("day8-part2", () => {
  let input =
`............
........0...
.....0......
.......0....
....0.......
......A.....
............
............
........A...
.........A..
............
............`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isAntennas = rh`${grid}.*i.*j != "."`
  let allAntennas = rh`[(udf.toNum *i), (udf.toNum *j)] | ${filterBy("*f0", isAntennas)} | array`
  let allAntennaPair = rh`udf.toNum(*x) < udf.toNum(*y) & {a:${allAntennas}.*x, b:${allAntennas}.*y}`
  let isPair = rh`${grid}.(${allAntennaPair}.a.0).(${allAntennaPair}.a.1) == ${grid}.(${allAntennaPair}.b.0).(${allAntennaPair}.b.1)`
  let antennaPairs = rh`${allAntennaPair} | ${filterBy("*f1", isPair)}`

  let isAntinode = rh`any (
   ((udf.toNum *i1) - ${antennaPairs}.a.0) % (${antennaPairs}.a.0 - ${antennaPairs}.b.0) == 0 &
   ((udf.toNum *j1) - ${antennaPairs}.a.1) == (${antennaPairs}.a.1 - ${antennaPairs}.b.1) * ((udf.toNum *i1) - ${antennaPairs}.a.0) / (${antennaPairs}.a.0 - ${antennaPairs}.b.0)
  )`
  let antinode = rh`${grid}.*i1.*j1 & ([(udf.toNum *i1), (udf.toNum *j1)] | ${filterBy("*", isAntinode)})`
  let query = rh`${antinode} | count`
  
  let func = api.compileC2(query, null)
  let res = func({input, udf})
  expect(res).toBe(34)
})
