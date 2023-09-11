let $data := 
[
    {key: "A", value: 10},
    {key: "B", value: 20},
    {key: "A", value: 30}
]

let $query := {|
    for $item in $data[]
    group by $key := $item.key
    return {
        $key: sum($item.value)
    }
    |}

return $query