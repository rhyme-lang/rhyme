
// XXX could use main api from rhyme.js
function ast_ident(a) {
    return { xxpath: "ident", xxparam: a }
}
function ast_raw(a) {
    return { xxpath: "raw", xxparam: a }
}
function ast_get(a,b) {
    return { xxpath: "get", xxparam: [a,b] }
}

//
// ---------- Textual parser ----------
//

exports.parse = (p) => {
    let as = p.split(".")
    if (as.length == 1) return ast_ident(as[0])
    let ret = ast_raw("inp")
    for (let i = 0; i < as.length; i++) {
        if (as[i] == "")
            continue // skip empty
        ret = ast_get(ret, ast_ident(as[i]))
    }
    return ret
}