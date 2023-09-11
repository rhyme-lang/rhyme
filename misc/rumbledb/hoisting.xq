(: to check whether JSONiq, (or the underlying Spark engine) hoists the nested un-correlated query :)
(: let $data := 
[
    {key: "A", value: 10},
    {key: "B", value: 20},
    {key: "A", value: 30}
] :)


let $data := json-file("dummy.json")

let $query := {|
  for $item in $data[]
  group by $key := $item.key
  return {
      $key: sum($item.value) div sum($data[].value)
  }
|}

return $query