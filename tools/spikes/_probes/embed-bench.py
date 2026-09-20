#!/usr/bin/env python3
"""Gate ⑧ probe: nomic-embed-text throughput on the hub via Ollama /api/embed (stdlib only)."""
import json, time, urllib.request, statistics
URL = "http://127.0.0.1:11434/api/embed"
def emb(texts):
    req = urllib.request.Request(URL, data=json.dumps({"model": "nomic-embed-text", "input": texts}).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=180).read())
emb(["warmup"])
sents = [f"Sentence {i}: a note about a meeting with a partner next week regarding the quarterly data and follow-ups." for i in range(1000)]
t = time.time(); per = []
for i in range(0, 1000, 50):
    t0 = time.time(); r = emb(sents[i:i + 50]); per.append((time.time() - t0) / 50)
total = time.time() - t
per.sort()
dim = len(r["embeddings"][0])
singles = []
for k in range(20):
    t0 = time.time(); emb([sents[k]]); singles.append(time.time() - t0)
singles.sort()
print(json.dumps({"total_1000_s": round(total, 1), "batch50_per_sentence_ms_p50": round(per[len(per)//2]*1000), "batch50_per_sentence_ms_p95": round(per[int(len(per)*0.95)]*1000), "single_call_ms_p50": round(singles[10]*1000), "single_call_ms_p95": round(singles[18]*1000), "dim": dim}))
