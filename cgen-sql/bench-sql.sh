#!/bin/bash
set -e

if [ "$#" -ne "1" ]; then
    echo "usage: bench-sql.sh <csv>"
    exit
fi

if ! command -v sqlite3 &> /dev/null; then
    echo "sqlite3 could not be found, please install it."
    exit 1
fi

sqlite3 data.db "drop table if exists bench;"
sqlite3 data.db "create table bench (str_col text, int_col1 int, int_col2 int);"

sqlite3 data.db <<EOF
.mode csv
.import --skip 1 $1 bench
EOF

sqlite3 data.db <<EOF
.timer on
.separator ": "
select sum(int_col2) from bench;
EOF

sqlite3 data.db <<EOF
.timer on
.separator ": "
select str_col, count(int_col1) from bench group by str_col;
EOF

sqlite3 data.db <<EOF
.timer on
.separator ": "
select int_col1, count(str_col) from bench group by int_col1;
EOF