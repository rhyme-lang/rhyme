// TODO: do not know how exactly to do this -- how to refer to some computed outer sum inside inner??
//      I guess I'll only use the first three examples in the paper
jq '{total: map(.value) | add} + (group_by(.key1) | map({(.[0].key1): ({total: map(.value) | add} + (group_by(.key2) | map({(.[0].key2): map(.value) | add}) | add )) }) | add)' data/toy.jq

