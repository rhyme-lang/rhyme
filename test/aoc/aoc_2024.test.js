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
  let func = api.compileC2(query)
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
  let func = api.compileC2(query)

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

  let isAntinode = rh`any (
    ((udf.toNum *i1) == (${antennaPairs}.a.0 + ${antennaPairs}.a.0 - ${antennaPairs}.b.0) &
    (udf.toNum *j1) == (${antennaPairs}.a.1 + ${antennaPairs}.a.1 - ${antennaPairs}.b.1)) ||
    ((udf.toNum *i1) == (${antennaPairs}.b.0 + ${antennaPairs}.b.0 - ${antennaPairs}.a.0) &
    (udf.toNum *j1) == (${antennaPairs}.b.1 + ${antennaPairs}.b.1 - ${antennaPairs}.a.1))
  )`
  let antinode = rh`${grid}.*i1.*j1 & ([(udf.toNum *i1), (udf.toNum *j1)] | ${filterBy("*", isAntinode)})`
  let query = rh`${antinode} | count`

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
  
  let func = api.compileC2(query)
  let res = func({input, udf})
  expect(res).toBe(34)
})

test("day9-part1", () => {
  let input = `2333133121414131402`

  let udf = {
    array: (a, d, file) => file !== undefined ? Array(Number(a)).fill(d) : Array(Number(a)).fill('.'),
    ...udf_stdlib,
  }

  let state = {
    disk: [],
    file: true,
    digit: 0,
    index: 0,
  }
  let createDisk = {
    disk: rh`[state.disk.*, (udf.array .input.(state.index) state.digit state.file).*]`,
    file: rh`ifElse state.file (1 == 2) true`,
    digit: rh`ifElse state.file (state.digit + 1) state.digit`,
    index: rh`state.index + 1`,
  }
  let func = api.compileC2(createDisk)
  while (state.index < input.length)
    state = func({input, udf, state})

  let res = {
    disk: state.disk,
    index: 0,
    sum: 0,
    last: state.disk.length - 1,
  }
  let compact = {
    disk: rh`ifElse (res.disk.(res.index) == ".") (update res.disk res.index res.disk.(res.last)) res.disk`,
    index: rh`ifElse (res.disk.(res.index) == ".") res.index (res.index + 1)`,
    sum: rh`ifElse (res.disk.(res.index) == ".") res.sum (res.sum + res.disk.(res.index) * res.index)`,
    last: rh`ifElse (res.disk.(res.index) == ".") (res.last - 1) res.last`,
  }
  let compactRec = api.compileC2(compact)

  while (res.index <= res.last)
    res = compactRec({udf, res})
  expect(res.sum).toBe(1928)
})

test("day9-part2", () => {
  let input = `2333133121414131402`

  let udf = {
    splice: (a, b) => array => array.slice(a, b),
    ...udf_stdlib,
  }

  let rh_length = rh`.input | udf.split "" | .*col | count`
  let func_length = api.compileC2(rh_length)
  let length = func_length({input, udf})

  let state = {
    disk: [],
    file: true,
    digit: 0,
    index: 0,
  }
  let createDisk = {
    disk: rh`ifElse state.file [state.disk.*, {index: state.digit, size: (.input.(state.index) | udf.toNum)}]
     [state.disk.*, {index: 0 - 1, size: (.input.(state.index) | udf.toNum)}]`,
    file: rh`ifElse state.file (1 == 2) true`,
    digit: rh`ifElse state.file (state.digit + 1) state.digit`,
    index: rh`state.index + 1`,
  }
  let func = api.compileC2(createDisk)
  while (state.index < length)
    state = func({input, udf, state})

  let state2 = {
    disk: state.disk,
    leftindex: 0,
    index: length - 1
  }
  let compact = {
    disk: rh`ifElse (state2.disk.(state2.index).index != 0 - 1 & state2.disk.(state2.leftindex).index == 0 - 1 & state2.disk.(state2.leftindex).size >= state2.disk.(state2.index).size) 
      [(state2.disk | udf.splice 0 state2.leftindex).*, state2.disk.(state2.index), {index: 0 - 1, size: state2.disk.(state2.leftindex).size - state2.disk.(state2.index).size}, (state2.disk | udf.splice state2.leftindex + 1 state2.index).*, {index: 0 - 1, size: state2.disk.(state2.index).size}, (state2.disk | udf.slice state2.index + 1).*] state2.disk`,
    leftindex: rh`ifElse (state2.disk.(state2.index).index == 0 - 1 || (state2.disk.(state2.leftindex).index == 0 - 1 & state2.disk.(state2.leftindex).size >= state2.disk.(state2.index).size) || (state2.index == state2.leftindex)) 1 (state2.leftindex + 1)`,
    index: rh`ifElse (state2.disk.(state2.index).index == 0 - 1 || (state2.disk.(state2.leftindex).index == 0 - 1 & state2.disk.(state2.leftindex).size >= state2.disk.(state2.index).size) || (state2.index == state2.leftindex)) 
      (state2.index - 1) state2.index`,
  }
  let compact_func = api.compileC2(compact)
  while (state2.index > 1)
    state2 = compact_func({udf, state2})

  let state3 = {
    index: 0,
    sumindex: 0,
    sum: 0,
  }
  let checksum = {
    index: rh`state3.index + 1`,
    sumindex: rh`state3.sumindex + state2.disk.(state3.index).size`,
    sum: rh`ifElse (state2.disk.(state3.index).index == 0 - 1) state3.sum (state3.sum + state2.disk.(state3.index).index * state2.disk.(state3.index).size * (state3.sumindex * 2 + state2.disk.(state3.index).size - 1) / 2)`,
  }
  let checksum_func = api.compileC2(checksum)
  while (state3.index < state2.disk.length)
    state3 = checksum_func({udf, state3, state2})
  expect(state3.sum).toBe(2858)
})

test("day10-part1", () => {
  let input =
`89010123
78121874
87430965
96549874
45678903
32019012
01329801
10456732`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    toSet: (arr) => arr.filter((value, index, self) =>
      index === self.findIndex(t => t.x === value.x && t.y === value.y && t.sx === value.sx && t.sy === value.sy)
    ),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0], [0, 1], [1, 0], [0, -1]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isStart = rh`${grid}.*i.*j == "0"`
  let startPos = rh`{x: (udf.toNum *i), y: (udf.toNum *j), sx: (udf.toNum *i), sy: (udf.toNum *j)} | ${filterBy("*f0", isStart)} | array`
  let rh_initialState = {
    grid: grid,
    positions: startPos,
    rowlen: rh`(${lines} | count | udf.toNum) - 1`,
    collen: rh`(${lines}.*0 | count | group *line | .0 | udf.toNum) - 1`,
  }
  let func = api.compileC2(rh_initialState)
  let initialState = func({input, udf})

  let state = {
    positions: initialState.positions,
    index: 0,
  }
  let newPos = rh`{x: state.positions.*pos.x + delta.*dir.0, y: state.positions.*pos.y + delta.*dir.1, sx: state.positions.*pos.sx, sy: state.positions.*pos.sy} | array`
  let isValid = rh`${newPos}.*p.x <= initialState.rowlen & ${newPos}.*p.x >= 0 & ${newPos}.*p.y <= initialState.collen & ${newPos}.*p.y >= 0 & (initialState.grid.(${newPos}.*p.x).(${newPos}.*p.y) | udf.toNum) == state.index + 1`
  let computeGraph = {
    positions: rh`${newPos}.*p | ${filterBy("*f0", isValid)} | array | udf.toSet`,
    index: rh`state.index + 1`,
  }
  let func2 = api.compileC2(computeGraph)
  while (state.index < 9)
    state = func2({udf, state, delta, initialState})

  let query = rh`state.positions.*p.x | count`
  let func3 = api.compileC2(query)
  let res = func3({udf, state})
  expect(res).toBe(36)
})

test("day10-part2", () => {
  let input =
`89010123
78121874
87430965
96549874
45678903
32019012
01329801
10456732`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0], [0, 1], [1, 0], [0, -1]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let isStart = rh`${grid}.*i.*j == "0"`
  let startPos = rh`{x: (udf.toNum *i), y: (udf.toNum *j), sx: (udf.toNum *i), sy: (udf.toNum *j)} | ${filterBy("*f0", isStart)} | array`
  let rh_initialState = {
    grid: grid,
    positions: startPos,
    rowlen: rh`(${lines} | count | udf.toNum) - 1`,
    collen: rh`(${lines}.*0 | count | group *line | .0 | udf.toNum) - 1`,
  }
  let func = api.compileC2(rh_initialState)
  let initialState = func({input, udf})

  let state = {
    positions: initialState.positions,
    index: 0,
  }
  let newPos = rh`{x: state.positions.*pos.x + delta.*dir.0, y: state.positions.*pos.y + delta.*dir.1, sx: state.positions.*pos.sx, sy: state.positions.*pos.sy} | array`
  let isValid = rh`${newPos}.*p.x <= initialState.rowlen & ${newPos}.*p.x >= 0 & ${newPos}.*p.y <= initialState.collen & ${newPos}.*p.y >= 0 & (initialState.grid.(${newPos}.*p.x).(${newPos}.*p.y) | udf.toNum) == state.index + 1`
  let computeGraph = {
    positions: rh`${newPos}.*p | ${filterBy("*f0", isValid)} | array`,
    index: rh`state.index + 1`,
  }
  let func2 = api.compileC2(computeGraph)
  while (state.index < 9)
    state = func2({udf, state, delta, initialState})

  let query = rh`state.positions.*p.x | count`
  let func3 = api.compileC2(query)
  let res = func3({udf, state})
  expect(res).toBe(81)
})

test("day11-part1", () => {
  let input =
`125 17`

  let udf = {
    isEvenDigit: (a) => a.toString().length % 2 == 0 ? true : undefined,
    splitNum1: (a) => Number(a.toString().slice(0, a.toString().length/2)),
    splitNum2: (a) => Number(a.toString().slice(a.toString().length/2)),
    ...udf_stdlib,
  }

  let nums = rh`.input | udf.split " " | .*num | udf.toNum | array`
  let frequency = rh`{val: ${nums}.*x, count: 1} | array`
  let compact = rh`{val: ${frequency}.*k.val, count: sum ${frequency}.*k.count} | group ${frequency}.*k.val | .* | array`
  let func = api.compileC2(compact)
  let state = func({input, udf})

  let newSeqNotEven = rh`(ifElse state.*c.val == 0 {val: 1, count: state.*c.count} (ifElse (udf.isEvenDigit state.*c.val) {val: 0, count: 0} {val: 2024 * state.*c.val, count: state.*c.count}))`
  let newSeqEven = rh`ifElse (udf.isEvenDigit state.*c.val) [{val: udf.splitNum1 state.*c.val, count: state.*c.count}, {val: udf.splitNum2 state.*c.val, count: state.*c.count}].* {val: 0, count: 0}`
  let newSeq = rh`[${newSeqNotEven}, ${newSeqEven}]`
  let compact2 = rh`{val: ${newSeq}.*kk.val, count: sum ${newSeq}.*kk.count} | group ${newSeq}.*kk.val | .* | array`

  let func1 = api.compileC2(compact2)
  for (let i = 0; i < 25; i++) {
    state = func1({udf, state})
  }

  let query = rh`state.*c.count | sum`
  let func2 = api.compileC2(query)
  let res = func2({state, udf})
  expect(res).toBe(55312)
})

test("day11-part2", () => {
  let input =
`125 17`

  let udf = {
    isEvenDigit: (a) => a.toString().length % 2 == 0 ? true : undefined,
    splitNum1: (a) => Number(a.toString().slice(0, a.toString().length/2)),
    splitNum2: (a) => Number(a.toString().slice(a.toString().length/2)),
    ...udf_stdlib,
  }

  let nums = rh`.input | udf.split " " | .*num | udf.toNum | array`
  let frequency = rh`{val: ${nums}.*x, count: 1} | array`
  let compact = rh`{val: ${frequency}.*k.val, count: sum ${frequency}.*k.count} | group ${frequency}.*k.val | .* | array`
  let func = api.compileC2(compact)
  let state = func({input, udf})

  let newSeqNotEven = rh`(ifElse state.*c.val == 0 {val: 1, count: state.*c.count} (ifElse (udf.isEvenDigit state.*c.val) {val: 0, count: 0} {val: 2024 * state.*c.val, count: state.*c.count}))`
  let newSeqEven = rh`ifElse (udf.isEvenDigit state.*c.val) [{val: udf.splitNum1 state.*c.val, count: state.*c.count}, {val: udf.splitNum2 state.*c.val, count: state.*c.count}].* {val: 0, count: 0}`
  let newSeq = rh`[${newSeqNotEven}, ${newSeqEven}]`
  let compact2 = rh`{val: ${newSeq}.*kk.val, count: sum ${newSeq}.*kk.count} | group ${newSeq}.*kk.val | .* | array`

  let func1 = api.compileC2(compact2)
  for (let i = 0; i < 75; i++) {
    state = func1({udf, state})
  }

  let query = rh`state.*c.count | sum`
  let func2 = api.compileC2(query)
  let res = func2({state, udf})
  expect(res).toBe(65601038650482)
})

test("day12-part1", () => {
  let input =
`RRRRIICCFF
RRRRIICCCF
VVRRRCCFFF
VVRCCCJFFF
VVVVCJJCFE
VVIVCCJJEE
VVIIICJJEE
MIIIIIJJEE
MIIISIJEEE
MMMISSJEEE`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    toSet: (arr) => arr.filter((value, index, self) =>
      index === self.findIndex(t => t.x === value.x && t.y === value.y && t.sx === value.sx && t.sy === value.sy)
    ),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0], [0, 1], [1, 0], [0, -1]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let parseInput = {
    rowlen: rh`(${lines} | count | udf.toNum)`,
    collen: rh`(${lines}.*0 | count | group *line | .0 | udf.toNum)`,
    cell: rh`${grid}.*i.*j & {x: (udf.toNum *i), y: (udf.toNum *j)} | array`,
    grid: grid,
  }
  let func = api.compileC2(parseInput)
  let initialState = func({input, udf})

  let state = {
    region: [initialState.cell[0]],
    contour: [initialState.cell[0]],
    cell: initialState.cell,
    price: 0,
    symbol: initialState.grid[0][0],
  }
  let bfs = rh`{x: state.contour.*contour.x + delta.*dir.0, y: state.contour.*contour.y + delta.*dir.1} | array | udf.toSet`
  let isValid = rh`${bfs}.*p.x < initialState.rowlen & ${bfs}.*p.x >= 0 & ${bfs}.*p.y < initialState.collen & ${bfs}.*p.y >= 0 & (initialState.grid.(${bfs}.*p.x).(${bfs}.*p.y) == state.symbol)`
  let cells = rh`${bfs}.*p | ${filterBy("*", isValid)} | array`
  let notvisited = rh`ifElse (any (${cells}.*cell.x == state.region.*regioncell.x & ${cells}.*cell.y == state.region.*regioncell.y)) 1 == 0 true`
  let newCells = rh`${cells}.*cell | ${filterBy("*", notvisited)} | array`
  let removeVisit = rh`ifElse (any (state.cell.*crv.x == state.contour.*ct.x & state.cell.*crv.y == state.contour.*ct.y)) 1 == 0 true`

  let regionFilled = rh`(state.contour.* | count) == 0`
  let newRegion = rh`ifElse ${regionFilled} [state.cell.0] [state.region.*, ${newCells}.*]`
  let area = rh`state.region.* | count`
  let neighbors = rh`{x: state.region.*region.x + delta.*dir.0, y: state.region.*region.y + delta.*dir.1} | array`
  let notInRegion = rh`${neighbors}.*n.x >= initialState.rowlen || ${neighbors}.*n.x < 0 || ${neighbors}.*n.y >= initialState.collen || ${neighbors}.*n.y < 0 || initialState.grid.(${neighbors}.*n.x).(${neighbors}.*n.y) != state.symbol`
  let perimeter = rh`${neighbors}.*n | ${filterBy("*", notInRegion)} | count`

  let fill = {
    region: rh`${newRegion}`,
    contour: rh`ifElse ${regionFilled} [state.cell.0] ${newCells}`,
    cell: rh`state.cell.*crv | ${filterBy("*", removeVisit)} | array`,
    price: rh`ifElse ${regionFilled} state.price + ${area} * ${perimeter} state.price`,
    symbol: rh`ifElse ${regionFilled} initialState.grid.(state.cell.0.x).(state.cell.0.y) state.symbol`,
  }
  let func1 = api.compileC2(fill)
  while (state.region.length != 0)
    state = func1({state, udf, delta, initialState})  
  expect(state.price).toBe(1930)
})

test("day12-part2", () => {
  let input =
`RRRRIICCFF
RRRRIICCCF
VVRRRCCFFF
VVRCCCJFFF
VVVVCJJCFE
VVIVCCJJEE
VVIIICJJEE
MIIIIIJJEE
MIIISIJEEE
MMMISSJEEE`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    toSet: (arr) => arr.filter((value, index, self) =>
      index === self.findIndex(t => t.x === value.x && t.y === value.y && t.sx === value.sx && t.sy === value.sy)
    ),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`
  let delta = [[-1, 0], [0, 1], [1, 0], [0, -1]]
  let delta2 = [[-1, 0], [0, 1], [1, 0], [0, -1], [-1, -1], [1, 1], [-1, 1], [1, -1]]

  let lines = rh`.input | udf.split "\\n" | .*line | udf.split ""`
  let grid = api.array(lines)
  let parseInput = {
    rowlen: rh`(${lines} | count | udf.toNum)`,
    collen: rh`(${lines}.*0 | count | group *line | .0 | udf.toNum)`,
    cell: rh`${grid}.*i.*j & {x: (udf.toNum *i), y: (udf.toNum *j)} | array`,
    grid: grid,
  }
  let func = api.compileC2(parseInput)
  let initialState = func({input, udf})

  let state = {
    region: [initialState.cell[0]],
    contour: [initialState.cell[0]],
    cell: initialState.cell,
    price: 0,
    symbol: initialState.grid[0][0],
  }
  let bfs = rh`{x: state.contour.*contour.x + delta.*dir.0, y: state.contour.*contour.y + delta.*dir.1} | array | udf.toSet`
  let isValid = rh`${bfs}.*p.x < initialState.rowlen & ${bfs}.*p.x >= 0 & ${bfs}.*p.y < initialState.collen & ${bfs}.*p.y >= 0 & (initialState.grid.(${bfs}.*p.x).(${bfs}.*p.y) == state.symbol)`
  let cells = rh`${bfs}.*p | ${filterBy("*", isValid)} | array`
  let notvisited = rh`ifElse (any (${cells}.*cell.x == state.region.*regioncell.x & ${cells}.*cell.y == state.region.*regioncell.y)) 1 == 0 true`
  let newCells = rh`${cells}.*cell | ${filterBy("*", notvisited)} | array`
  let removeVisit = rh`ifElse (any (state.cell.*crv.x == state.contour.*ct.x & state.cell.*crv.y == state.contour.*ct.y)) 1 == 0 true`

  let regionFilled = rh`(state.contour.* | count) == 0`
  let newRegion = rh`ifElse ${regionFilled} [state.cell.0] [state.region.*, ${newCells}.*]`
  let area = rh`state.region.* | count`

  let doublegrid = rh`[{x: state.region.*region.x * 2, y: state.region.*region.y * 2},
                       {x: state.region.*region.x * 2 + 1, y: state.region.*region.y * 2},
                       {x: state.region.*region.x * 2, y: state.region.*region.y * 2 + 1},
                       {x: state.region.*region.x * 2 + 1, y: state.region.*region.y * 2 + 1}
                      ].* | array`
  let neighbors = rh`{x: ${doublegrid}.*dg.x + delta2.*dir2.0, y: ${doublegrid}.*dg.y + delta2.*dir2.1}`
  let inRegion = rh`initialState.grid.(ifElse (${neighbors}.x % 2 == 0) ${neighbors}.x / 2 (${neighbors}.x - 1) / 2).(ifElse (${neighbors}.y % 2 == 0) ${neighbors}.y / 2 (${neighbors}.y - 1) / 2) == state.symbol`
  let filterNeighbors = rh`${neighbors} | ${filterBy("*", inRegion)}`
  let neighborCount = rh`count ${filterNeighbors} | group *dg | .* | array`
  let is347 = rh`${neighborCount}.*nc == 3 || ${neighborCount}.*nc == 4 || ${neighborCount}.*nc == 7`
  let perimeter = rh`${neighborCount}.*nc | ${filterBy("*", is347)} | count`

  let fill = {
    test: rh`${perimeter}`,
    test2: rh`${neighborCount}`,
    region: rh`${newRegion}`,
    contour: rh`ifElse ${regionFilled} [state.cell.0] ${newCells}`,
    cell: rh`state.cell.*crv | ${filterBy("*", removeVisit)} | array`,
    price: rh`ifElse ${regionFilled} state.price + ${area} * ${perimeter} state.price`,
    symbol: rh`ifElse ${regionFilled} initialState.grid.(state.cell.0.x).(state.cell.0.y) state.symbol`,
  }
  let func1 = api.compileC2(fill, null)
  while (state.region.length != 0)
    state = func1({state, udf, delta, delta2, initialState})  
  expect(state.price).toBe(1206)
})

test("day13-part1", () => {
  let input =
`Button A: X+94, Y+34
Button B: X+22, Y+67
Prize: X=8400, Y=5400

Button A: X+26, Y+66
Button B: X+67, Y+21
Prize: X=12748, Y=12176

Button A: X+17, Y+86
Button B: X+84, Y+37
Prize: X=7870, Y=6450

Button A: X+69, Y+23
Button B: X+27, Y+71
Prize: X=18641, Y=10279`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    splice: array => array.slice(0, -1),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let machine = rh`.input | udf.split "\\n\\n" | .*machine`
  let line = rh`${machine} | udf.split "\\n" | .*line`
  let word = rh`${line} | udf.split " " | .*word`
  let number = rh`${word} | udf.slice 2 | group *word | group *line | group *machine`
  let createobject = rh`{ax: (udf.splice ${number}.*num.0.2 | udf.toNum), ay: (${number}.*num.0.3 | udf.toNum), bx: (udf.splice ${number}.*num.1.2 | udf.toNum), by: (${number}.*num.1.3 | udf.toNum), px: (udf.splice ${number}.*num.2.1 | udf.toNum), py: (${number}.*num.2.2 | udf.toNum)} | array`

  let func = api.compileC2(createobject)
  let machineData = func({input, udf})

  let state = {
    token: Array(machineData.length).fill(1000),
    indexa: 0,
    indexb: 0,
  }
  let isValid = rh`(machineData.*m.ax * state.indexa + machineData.*m.bx * state.indexb == machineData.*m.px)
                 & (machineData.*m.ay * state.indexa + machineData.*m.by * state.indexb == machineData.*m.py)`
  let isLess = rh`state.indexa * 3 + state.indexb < state.token.*m`
  let solve = {
    token: rh`(ifElse (${isValid} & ${isLess}) (state.indexa * 3 + state.indexb) state.token.*m) | array`,
    indexa: rh`ifElse state.indexb == 100 state.indexa + 1 state.indexa`,
    indexb: rh`ifElse state.indexb == 100 0 state.indexb + 1`,
  }
  let func1 = api.compileC2(solve)
  while (!(state.indexa == 100 && state.indexb == 100))
    state = func1({state, udf, machineData})
  let sum = rh`state.token.*t | ${filterBy("*", rh`state.token.*t != 1000`)} | sum`
  let func2 = api.compileC2(sum)
  let res = func2({state, udf})
  expect(res).toBe(480)
})

test("day13-part2", () => {
  let input =
`Button A: X+94, Y+34
Button B: X+22, Y+67
Prize: X=8400, Y=5400

Button A: X+26, Y+66
Button B: X+67, Y+21
Prize: X=12748, Y=12176

Button A: X+17, Y+86
Button B: X+84, Y+37
Prize: X=7870, Y=6450

Button A: X+69, Y+23
Button B: X+27, Y+71
Prize: X=18641, Y=10279`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    splice: array => array.slice(0, -1),
    ...udf_stdlib,
  }
  let filterBy = (gen, p) => x => rh`(udf.filter ${p}).${gen} & ${x}`

  let machine = rh`.input | udf.split "\\n\\n" | .*machine`
  let line = rh`${machine} | udf.split "\\n" | .*line`
  let word = rh`${line} | udf.split " " | .*word`
  let number = rh`${word} | udf.slice 2 | group *word | group *line | group *machine`
  let createobject = rh`{ax: (udf.splice ${number}.*num.0.2 | udf.toNum), ay: (${number}.*num.0.3 | udf.toNum), bx: (udf.splice ${number}.*num.1.2 | udf.toNum), by: (${number}.*num.1.3 | udf.toNum), px: (udf.splice ${number}.*num.2.1 | udf.toNum) + 10000000000000, py: (${number}.*num.2.2 | udf.toNum) + 10000000000000} | array`

  let bnumerator = rh`${createobject}.*m.px * ${createobject}.*m.ay - ${createobject}.*m.py * ${createobject}.*m.ax`
  let bdenominator = rh`${createobject}.*m.bx * ${createobject}.*m.ay - ${createobject}.*m.by * ${createobject}.*m.ax`
  let b = rh`ifElse (${bdenominator} == 0 || ${bnumerator} % ${bdenominator} != 0) 0 (${bnumerator} / ${bdenominator})`
  let anumerator = rh`${createobject}.*m.px - ${b} * ${createobject}.*m.bx`
  let a = rh`ifElse (${createobject}.*m.ax == 0 || ${anumerator} % ${createobject}.*m.ax != 0) 0 (${anumerator} / ${createobject}.*m.ax)`

  let isValid = rh`${bdenominator} != 0 & ${bnumerator} % ${bdenominator} == 0 & ${createobject}.*m.ax != 0 & ${anumerator} % ${createobject}.*m.ax == 0`
  let token = rh`ifElse ${isValid} (${a} * 3 + ${b}) 0`
  let query = rh`sum ${token}`
  let func = api.compileC2(query, null)
  let res = func({input, udf})
  expect(res).toBe(875318608908)
})
