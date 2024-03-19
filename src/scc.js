/**
  Return the strongly connected components
  of the graph rooted at the first argument,
  whose edges are given by the function argument.
  The scc are returned in topological order.
  Tarjan's algorithm (linear).
*/

//
// scc(start: List[T], succ: T => List[T]): List[List[T]]
//

function stronglyConnectedComponents(start, succ) {
  let id = 0
  let stack = [] // Stack[T]
  let mark = {}  // Map[T,Int]
  let res = []   // List[List[T]]
  //
  // visit[T](node: T): Int
  //
  function visit(node) {
    if (mark[node]) return mark[node]
    // push node
    mark[node] = ++id
    stack.push(node)
    let min = id
    for (let child of reverse(succ(node)??[])) {
      let m = visit(child)
      if (m < min) min = m
    }
    if (min == mark[node]) {
      let scc = []
      for (;;) {
        // append element
        let element = stack.pop()
        scc.push(element)
        mark[element] = Number.MAX_SAFE_INTEGER
        if (element == node) break
      }
      res.push(scc.reverse())
    }
    return min
  }
  for (let node of reverse(start))
    visit(node)
  return res.reverse()
}
function* reverse(array) {
  let i = array.length;
  while (0 < i) {
    yield array[--i];
  }
}

exports.scc = stronglyConnectedComponents


// test("ABC", function() {
//   let start = ["A","B"]
//   let succ = {
//     "A": ["C"],
//     "B": ["C"],
//   }
//   let s = stronglyConnectedComponents(start, x => succ[x])
//   expect(s).toEqual([["A"],["B"],["C"]])
// })
// test("ABCD", function() {
//   let start = ["A"]
//   let succ = {
//     "A": ["B"],
//     "B": ["C"],
//     "C": ["A","D"]
//   }
//   let s = stronglyConnectedComponents(start, x => succ[x])
//   expect(s).toEqual([["A","B","C"],["D"]])
// })

