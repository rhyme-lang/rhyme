#!/bin/bash
set -e

if [ "$#" -ne "1" ]; then
    echo "usage: bench.sh <source_dir>"
    exit
fi

if [ -z "$CC" ]; then
    CC="cc"
fi

if [ -z "$CFLAGS" ]; then
    CFLAGS="-std=c99 -O3"
fi

srcdir="$1"

benchlog="$srcdir/log.txt"

echo "logging to $benchlog"
echo "" > $benchlog

for file in "$srcdir"/*.c; do
    cmd="$CC $CFLAGS $file -o $srcdir/tmp"
    echo "Running: $cmd"

    $cmd
    time ("$srcdir/tmp") 2>> $benchlog
done

