#!/bin/bash

DATA_DIR=cgen-sql/data/bluesky

wget --continue --timestamping --progress=dot:giga --directory-prefix $DATA_DIR --input-file <(seq --format "https://clickhouse-public-datasets.s3.amazonaws.com/bluesky/file_%04g.json.gz" 1 10)

zcat $DATA_DIR/file_0001.json.gz \
     $DATA_DIR/file_0002.json.gz \
     $DATA_DIR/file_0003.json.gz \
     $DATA_DIR/file_0004.json.gz \
     $DATA_DIR/file_0005.json.gz \
     $DATA_DIR/file_0006.json.gz \
     $DATA_DIR/file_0007.json.gz \
     $DATA_DIR/file_0008.json.gz \
     $DATA_DIR/file_0009.json.gz \
     $DATA_DIR/file_0010.json.gz \
     > $DATA_DIR/bluesky.json
