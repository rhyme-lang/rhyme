set -e

DATA_DIR=./cgen-sql/data/linux_commits
DATA_FILE=$DATA_DIR/commits.json
URL=https://api.github.com/repos/torvalds/linux/commits

rm -f $DATA_FILE
mkdir -p $DATA_DIR
touch $DATA_FILE

for i in $(seq 1 100); do
    curl $URL?per_page=100\&page=$i | jq -c '.' >> $DATA_FILE
done


