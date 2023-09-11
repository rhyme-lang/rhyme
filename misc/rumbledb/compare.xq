(:
to run: java -jar rumbledb-1.21.0-standalone.jar compare.xq | tail -n 1 | jq .D
(using jq to prettify the output json)
 :)

let $data := 
[
    {key: "A", value: 10},
    {key: "B", value: 20},
    {key: "A", value: 30}
]

(: -----------------------------------------Simple----------------------------------------- :)
(: raw values :)
let $q1 := $data[].value

(: sum :)
let $q2 := sum($data[].value)

(: average :)
let $q3 := avg($data[].value)

(: -----------------------------------------Group-by----------------------------------------- :)
(: example 1 :)
(: 
let query = {
  total: api.sum("data.*.value"),
  "data.*.key": api.sum("data.*.value"),
}

:)

let $q_exp_1_1 := {|
    for $item in $data[]
    group by $key := $item.key
    return {
        $key: sum($item.value)
    },
    {"total": sum($data[].value)}
    |}

(: example 2: group-by + average :)
(:
let query = {
  total: api.sum("data.*.value"),
  "data.*.key": avg("data.*.value"),
}
:)

let $q_exp_1_2 := {|
    for $item in $data[]
    group by $key := $item.key
    return {
        $key: sum($item.value) div count($item.value)
    },
    {"total": sum($data[].value)}
    |}


(: example 3: group-by Relative Sum :)
(: 
let query = {
  total: api.sum("data.*.value"),
  "data.*.key": api.fdiv(api.sum("data.*.value"),api.sum("data.*B.value"))
}
 :)

(: TODO: is the inner sum hoisted automatically?? :)
let $q_exp_1_3 := {|
  {"total": sum($data[].value)},
  for $item in $data[]
  group by $key := $item.key
  return {
      $key: sum($item.value) div sum($data[].value)
  }
|}


(: Example 4: Nested Group and Aggregate :)

let $data2 := [
  {region: "Asia", country: "Japan", city: "Tokyo", population: 30},
  {region: "Asia", country: "China", city: "Beijing", population: 20},
  {region: "Europe", country: "France", city: "Paris", population: 10},
  {region: "Europe", country: "UK", city: "London", population: 10}
]

(: 
let query = {
  total: api.sum("data.*.population"),
  "data.*.region": {
    total: api.sum("data.*.population"),
    "data.*.city": api.sum("data.*.population")
  },
}
 :)
 (: Note - concise and controllable iteration via "*" :)

let $q_exp_1_4 := {|
    {"total": sum($data2[].population)},
    for $region_item in $data2[]
    group by $region := $region_item.region
    return {
        $region: 
            {|
            {"total": sum($region_item.population)},
            for $country_item in $region_item
              group by $country := $country_item.city
              return {
                  $country: $country_item.population
              }
            |}
    }
|}



(: -----------------------------------------Join----------------------------------------- :)

(: Example 1: Join :)
let $other := [
  {region: "Asia", country: "Japan"},
  {region: "Asia", country: "China"},
  {region: "Europe", country: "France"},
  {region: "Europe", country: "UK"}
]

let $data3 := [
  {country: "Japan", city: "Tokyo", population: 30},
  {country: "China", city: "Beijing", population: 20},
  {country: "France", city: "Paris", population: 10},
  {country: "UK", city: "London", population: 10}
]

(:
let query = {
  "-": api.merge(api.get(q1,"data.*.country"), {
    "data.*.city": api.sum("data.*.population")
  }),
} 
 :)

 (: 
 TODO: should we have a more datalog-style join?

let query = 
    data(country:c), other(country:c) {res => // joined object
        "res.*.region" : {
            "res.*.city": api.sum("res.*.population")
        }
    }
  :)

  (:
TODO: our implementation currently only has foreign key based left outer joins (see the generated code in the TR's notes)
        do we need more expressive joins?
  :)

let $q_join_1 := {|
      for $left in $other[]
      group by $region := $left.region
      return {
          $region: {|                                  (: TODO - if I had used $left.region it duplicates the group by -- feature or bug? :)
              for $right in $data3[]
              where $left.country = $right.country
              return {
                  $right.city: $right.population 
              }
              |}
      }
    |}


(: Example 2: Join with aggregate :)

(:
let query = {
  total: api.sum("data.*.population"),
  "-": api.merge(api.get(q1,"data.*.country"), {
    total: api.sum("data.*.population"),
    "data.*.city": api.sum("data.*.population")
  }),
}
:)

let $q_join_2 := {|
      {"total": sum($data3[].population)},
      for $region_item in $other[], $country_item in $data3[]
      where $region_item.country = $country_item.country
      group by $region := $region_item.region
      return {
          $region:
              {|
                {"total": sum($country_item.population)},
                for $city in $country_item
                return {
                    $city.city: $city.population
                }
              |}
      }
    |}

(: change this to the query you want to run :)
return $q_join_2 
