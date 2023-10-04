jq '{total: map(.value) | add} + (group_by(.key1) | map({(.[0].key1): ({total: map(.value) | add} + (group_by(.key2) | map({(.[0].key2): map(.value) | add}) | add )) }) | add)' data/toy.jq

