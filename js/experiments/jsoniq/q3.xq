(: java -jar ~/phd/research/work/query-language/rumbledb/rumbledb-1.21.0-standalone.jar run q1.xq :)
(: can set --parallel-execution no :)

(: compute nested group-by (i.e., group by key1, then key2) :)

let $data := json-file("/Users/supun/phd/research/work/js-queries/js/experiments/data/toy.json")
return 
    {|
        for $data_item in $data
        group by $key := $data_item.key1
        return {
            $key : {|
                for $nested_item in $data_item
                group by $nested_key := $nested_item.key2
                return {
                    $nested_key : sum($nested_item.value)
                },
                {"total": sum($data_item.value)}
            |}
        },
        {"total" : sum($data.value)}
    |}