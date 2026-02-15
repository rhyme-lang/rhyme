set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <github_token>"
    exit 1
fi

TOKEN=$1

DATA_DIR=./cgen-sql/data/commits
DATA_FILE=$DATA_DIR/commits.json
URL=https://api.github.com/repos/torvalds/linux/commits

rm -f $DATA_FILE
mkdir -p $DATA_DIR
touch $DATA_FILE

for i in $(seq 1 10000); do
    echo "Fetching page $i/10000..."
    curl -s -H "Authorization: Bearer $TOKEN" "$URL?per_page=100&page=$i" | jq -c '.' >> $DATA_FILE
    sleep 1  # Stay under GitHub's 5000 requests/hour rate limit
done


