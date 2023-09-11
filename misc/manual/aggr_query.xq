(: let $data := json-file("data/data_1M_1k.jsonl") :)
let $data := json-file("data/data_10_2.jsonl")

(: this cannot be handled in the parallel version of RumbleDB :)
(: this is because the ... / sum($data.value) logic is handled as a UDF in the 
parallel Spark job of for .., and it cannot spawn another parallel job witihin a parallel job! --> limitation! :)
(: let $query := {|
        for $item in $data
        group by $key := $item.key
        return {
            $key: sum($item.value) div sum($data.value)
        }
    |} :)

(: unnested version :)
(: let $total := sum($data.value)

let $query := {|
    for $item in $data
    group by $key := $item.key
    return {
        $key: sum($item.value) div $total
    }
|} :)

(: return $query :)


(: correlated query :)
(: TODO: so this correlated query cannot be handled directly in JSONiq? have to manually unnest somehow? :)
(: let $query_correlated := {|
    for $item in $data
    group by $key := $item.key
    return {
        $key: 
            let $corr_sum := 
                for $item2 in $data
                where $item2.key = $key
                return $item2.value
            return sum($item.value) div sum($corr_sum)
    }
|}

return $query_correlated :)
