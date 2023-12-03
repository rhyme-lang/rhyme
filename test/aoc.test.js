const { api, pipe } = require('../src/rhyme')
const { rh } = require('../src/parser')


// 2022

test("day1", () => {
    let input = `1000
2000
3000

4000

5000
6000

7000
8000
9000

10000`
  // utilities to split input
  let udf = {
    splitNN: x => x.split("\n\n"),
    splitN: x => x.split("\n"),
    toNum: x => Number(x),
  }
  // potential textual syntax:
  // input | split "\n\n"  | get *chunk
  //       | split "\n"    | get *line  | toNum
  //       | sum | group *chunk | get * | max
  let root = {xxpath:"raw", xxparam: "inp"} // XXX
  let query =
    pipe(root).get("input")
    .map("udf.splitNN").get("*chunk")
    .map("udf.splitN").get("*line")
    .map("udf.toNum")
    .sum()
    .group("*chunk").get("*")
    .max()
  let func = api.query(query)
  let res = func({input, udf})
  console.dir(res)
  expect(res).toBe(24000)
})