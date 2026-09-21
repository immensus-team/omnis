#!/bin/bash
# Usage: korean-gate.sh <path...>  — fails if any tracked non-fixture, non-dist file in scope has Korean outside lines marked [ko-sample]
export LC_ALL=en_US.UTF-8; export PATH=/opt/homebrew/bin:$PATH
bad=0
for f in $(git ls-files "$@" | grep -v '/dist/' | grep -v '/fixtures/' | grep -v '\.jsonl$' | grep -v '\.png$' | grep -v '\.webp$'); do
  n=$(grep -v '\[ko-sample\]' "$f" | grep -c '[가-힣]'); [ "$n" -gt 0 ] && { echo "$f: $n lines with Korean"; bad=$((bad+1)); }
done
echo "files with Korean: $bad"; [ $bad -eq 0 ]
