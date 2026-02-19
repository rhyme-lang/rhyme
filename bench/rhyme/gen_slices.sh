#!/bin/bash
DATA_DIR=./cgen-sql/data/commits
mkdir -p $DATA_DIR/sliced
for n in $(seq 0 50 500); do
    head -n $n $DATA_DIR/commits.json > $DATA_DIR/sliced/commits_${n}.json
done
echo "Created $(ls $DATA_DIR/sliced/commits_*.json | wc -l) slice files."