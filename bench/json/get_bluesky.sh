#!/bin/bash

DATA_DIR=cgen-sql/data/bluesky
OUT_FILE=$DATA_DIR/bluesky.json

wget --continue --timestamping --progress=dot:giga --directory-prefix $DATA_DIR --input-file <(seq --format "https://clickhouse-public-datasets.s3.amazonaws.com/bluesky/file_%04g.json.gz" 1 10)

zcat $DATA_DIR/file_0001.json.gz > $OUT_FILE
zcat $DATA_DIR/file_0002.json.gz >> $OUT_FILE
zcat $DATA_DIR/file_0003.json.gz >> $OUT_FILE
zcat $DATA_DIR/file_0004.json.gz >> $OUT_FILE

zcat $DATA_DIR/file_0005.json.gz > $DATA_DIR/file_0005.json
sed -i '91840{N;s/\n//}' $DATA_DIR/file_0005.json
cat $DATA_DIR/file_0005.json >> $DATA_DIR/bluesky.json
rm $DATA_DIR/file_0005.json

zcat $DATA_DIR/file_0006.json.gz > $DATA_DIR/file_0006.json
sed -i '17282{N;s/\n//}' $DATA_DIR/file_0006.json
cat $DATA_DIR/file_0006.json >> $DATA_DIR/bluesky.json
rm $DATA_DIR/file_0006.json

zcat $DATA_DIR/file_0007.json.gz > $DATA_DIR/file_0007.json
sed -i '752367{N;s/\n//}' $DATA_DIR/file_0007.json
cat $DATA_DIR/file_0007.json >> $DATA_DIR/bluesky.json
rm $DATA_DIR/file_0007.json

zcat $DATA_DIR/file_0008.json.gz >> $OUT_FILE
zcat $DATA_DIR/file_0009.json.gz >> $OUT_FILE
zcat $DATA_DIR/file_0010.json.gz >> $OUT_FILE

sed -i 's/\\u0000//g' $OUT_FILE
