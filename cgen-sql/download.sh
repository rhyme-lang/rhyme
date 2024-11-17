#!/bin/bash
set -e

wget http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-1gram-20120701-a.gz
gunzip googlebooks-eng-all-1gram-20120701-a.gz
mv googlebooks-eng-all-1gram-20120701-a 1gram_a.csv

gcc -o convert convert.c
./convert 1gram_a.csv

mv out.csv t1gram_full.csv
