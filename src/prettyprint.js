// const { api } = require('./rhyme')
const { sets } = require('./shared')
const { types, typeSyms, props } = require('./types')

const { unique, union, intersect, diff, subset, same } = sets


// ----- auxiliary state -----

let settings

let prefixes      // canonicalize * for every prefix, e.g., data.* (preproc)
let path          // current grouping path variables (extract)

let vars          // deps var->var, var->tmp
let hints
let filters
let assignments


exports.setEmitPseudoState = st => {
  settings = st.settings
  prefixes = st.prefixes
  path = st.path
  vars = st.vars
  hints = st.hints
  filters = st.filters
  assignments = st.assignments
}


// contract: pretty, prettyPath should be stateless, i.e.,
// do not rely on settings, filters, assigments, etc

let prettyPath = es => {
  if (es === undefined) return "[?]"
  let sub = x => typeof(x) === "string" ? x : pretty(x)
  return "[" + es.map(sub).join(",") + "]"
}

let pretty = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "loadInput") {
    let [e1] = q.arg.map(pretty)
    return `loadInput('${q.op}', ${e1})`
  } else if (q.key == "const") {
    if (typeof q.op === "object" && Object.keys(q.op).length == 0) return "{}"
    else return ""+q.op
  } else if (q.key == "var") {
    return q.op
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    return "tmp"+q.op+prettyPath(e1.fre)
  } else if (q.key == "genref") {
    //let e1 = filters[q.op]
    return "gen"+q.op
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(pretty)
    if (e1 == "inp") return e2
    // if (q.arg[1].key == "var") { // hampers CSE pre-extract
      // if (q.filter === undefined) // def
        // return e2 + " <- " + e1
    // }
    if (q.mode == "maybe")
      return e1+"["+e2+"?]"
    return e1+"["+e2+"]"
  } else if (q.key == "pure") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "mkTuple") {
    let es = q.arg.map(pretty)
    return "mkTuple(" + es.join(", ") + ")"
  } else if (q.key == "hint") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(pretty)
    return "mkset("+e1+")"
  } else if (q.key == "prefix") {
    let [e1] = q.arg.map(pretty)
    return "prefix_"+q.op+"("+e1+")"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(pretty)
    let suffix = ""
    if (q.mode == "maybe")
      suffix = "?"
    return q.op+suffix+"("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(pretty)
    return "{ "+ e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg.map(pretty)
    if (e3) return e0+ "{ "+ e1 + ": " + e2 + " } / " + e3
    return e0+ "{ "+ e1 + ": " + e2 + " }"
  } else {
    console.error("unknown op", q)
  }
}

exports.pretty = pretty


// ----- types -----

let prettyType = (schema) => {
    if (schema === undefined)
        return "~Undefined~";
    if (schema === null)
        return "~Null~";
    if (schema.typeSym in types)
        return schema.typeSym
    if (typeof schema === "string")
        return "\"" + schema + "\"";
    if (schema.typeSym === typeSyms.union)
        return "(" + Array.from(schema.unionSet).map(type => prettyType(type)).join(" | ") + ")";
    if (schema.typeSym === typeSyms.intersect)
        return "(" + Array.from(schema.intersectSet).map(type => prettyType(type)).join(" & ") + ")";
    if (schema.typeSym === typeSyms.function)
        return "(" + schema.funcParams.map(type => prettyType(type)).join(", ") + ") -> " + prettyType(schema.funcResult);
    if (schema.typeSym === typeSyms.dynkey)
        return `<${schema.keySymbol}: ${prettyType(schema.keySupertype)}>`;
    if (schema.typeSym === typeSyms.tagged_type)
        return schema.tag +":"+prettyType(schema.tagInnertype);
    if (schema.typeSym === typeSyms.object) {
        if (schema.objKey === null)
            return "{}";
        else
            return `${prettyType(schema.objParent)}{${prettyType(schema.objKey)}: ${prettyType(schema.objValue)}}`;
    }
    if (typeof schema === "object")
        return "~UNK:" + JSON.stringify(schema) + "~";
    return "~Invalid~";
}

let prettyTypeTuple = (tuple) => {
    if (tuple === undefined)
        return "~Undefined~";
    let propStr = "";
    if (tuple.props.includes(props.nothing)) {
        if (tuple.props.includes(props.error))
            propStr = "N,E";
        else
            propStr = "N";
    } else if (tuple.props.includes(props.error))
        propStr = "E";
    else
        propStr = "/";
    return prettyType(tuple.type) + " | " + propStr;
}

exports.prettyType = prettyType
exports.prettyTypeTuple = prettyTypeTuple


let pseudoVerbose = false

let emitPseudo = (q) => {
  let margin = 16
  let buf = []
  for (let i in filters) {
    let q = filters[i]
    buf.push(("gen"+i + prettyPath(q.fre)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + prettyTypeTuple(q.schema))
    if (pseudoVerbose && q.fre.length)
      buf.push("  " + q.fre)
  }
  if (hints.length) buf.push("")
  for (let i in hints) {
    let q = hints[i]
    buf.push(("hint"+i + prettyPath(q.fre)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + prettyTypeTuple(q.schema))
    if (pseudoVerbose && q.fre.length)
      buf.push("  " + q.fre)
  }
  if (pseudoVerbose) {
    buf.push("")
    let hi = buf.length
    for (let v in vars) {
      if (vars[v].vars.length > 0 || vars[v].tmps && vars[v].tmps.length > 0)
        buf.push(v + " -> " + vars[v].vars +"  "+ (vars[v].tmps??[]))
    }
  }
  buf.push("")
  hi = buf.length
  for (let v in vars) {
    if (vars[v].vars.length > 0 || vars[v].tmps && vars[v].tmps.length > 0)
      buf.push(v + " -> " + vars[v].vars +"  "+ (vars[v].tmps??[]))
  }
  if (buf.length > hi)
    buf.push("")
  for (let i in assignments) {
    let q = assignments[i]
    buf.push(("tmp"+i + prettyPath(q.fre) + prettyPath(q.bnd)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + prettyTypeTuple(q.schema))
    if (!pseudoVerbose) continue
    if (q.path?.length > 0)
      buf.push("  pth: " + q.path.map(pretty))
    if (q.vars.length > 0)
      buf.push("  var: " + q.vars)
    if (q.tmps?.length > 0)
      buf.push("  tmp: " + q.tmps)
    if (q.mind.length > 0)
      buf.push("  min: " + q.mind)
    if (q.dims.length > 0)
      buf.push("  dim: " + q.dims)
    if (q.out?.length > 0)
      buf.push("  out: " + q.out)
    if (q.iterInit?.length > 0)
      buf.push("  it0: " + q.iterInit)
    if (q.iter?.length > 0)
      buf.push("  itr: " + q.iter)
    if (q.free?.length > 0)
      buf.push("  fr1: " + q.free)
    if (q.fre?.length > 0)
      buf.push("  fre: " + q.fre)
    if (q.bound?.length > 0)
      buf.push("  bn1: " + q.bound)
    if (q.bnd?.length > 0)
      buf.push("  bnd: " + q.bnd)
  }
  buf.push(pretty(q))
  buf.push(": " + prettyTypeTuple(q.schema))
  if (q.fre?.length > 0)
    buf.push("  " + q.fre)
  return buf.join("\n")
}


exports.prettyPath = prettyPath

exports.emitPseudo = emitPseudo
