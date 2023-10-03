(: java -jar ~/phd/research/work/query-language/rumbledb/rumbledb-1.21.0-standalone.jar run q1.xq :)
(: can set --parallel-execution no :)

(: compute group-by aggregate :)

(: let $data := json-file("/Users/supun/phd/research/work/js-queries/js/experiments/data/toy.json") :)

let $q2 := {|
    for $data_item in json-file("/Users/supun/phd/research/work/js-queries/js/experiments/data/toy.json")
    group by $key := $data_item.key1
    return {
        $key : sum($data_item.value)
    },
    {"total": sum(json-file("/Users/supun/phd/research/work/js-queries/js/experiments/data/toy.json").value)} |}

return $q2