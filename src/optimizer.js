
let optimizer = {}
exports.optimizer = optimizer;

let deduplicate = (q, cseMap) => {
    let qString = JSON.stringify(q);
    if(cseMap[qString])
        return cseMap[qString];
    cseMap[qString] = q;
    if(q.arg)
        q.arg = q.arg.map(arg => deduplicate(arg, cseMap));
    return q;
}
optimizer.deduplicate = deduplicate;

/*
 TODO: 
 - Eta Reduction
 - Constant Folding
 - Non-intersection of object key and get key
 Thoughts:
 - Once dependencies are determined, "andThen" can be removed, no?
*/