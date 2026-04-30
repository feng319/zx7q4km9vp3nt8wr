import json, re, os
from collections import Counter

idx = json.load(open(r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus\skus_index.json', encoding='utf-8'))
skus = idx['skus']

print('=== SKU Counts ===')
cls = Counter(s.get('classification','?') for s in skus)
for k,v in cls.most_common():
    print(f'  {k}: {v}')
print(f'  Total: {len(skus)}')
print(f'  Chunks processed: {len(idx.get("chunks_processed",[]))}')

# Orphan analysis
sku_ids = set(s['sku_id'] for s in skus)
rel_skus = [s for s in skus if s.get('classification') == 'relational']
print(f'\n=== Relational SKU Details ===')
print(f'Relational count: {len(rel_skus)}')
for r in rel_skus[:3]:
    print(f'  {r["sku_id"]}: {r["name"]}')

# Check relational directory for actual files
rel_dir = r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus\relational'
if os.path.exists(rel_dir):
    rel_files = os.listdir(rel_dir)
    print(f'Relational files on disk: {len(rel_files)}')
else:
    print('Relational directory not found')

# Check all subdirectories
base = r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus'
for d in os.listdir(base):
    dp = os.path.join(base, d)
    if os.path.isdir(dp):
        files = [f for f in os.listdir(dp) if not f.startswith('.')]
        print(f'  {d}/: {len(files)} files')

# Dedup / relation analysis from actual relational files
if os.path.exists(rel_dir):
    pred_counts = Counter()
    for f in os.listdir(rel_dir):
        if f.endswith('.json'):
            data = json.load(open(os.path.join(rel_dir, f), encoding='utf-8'))
            content = data.get('content', '')
            if isinstance(content, dict):
                pred = content.get('predicate', '?')
                pred_counts[pred] += 1
    print(f'\n=== Predicate Distribution ===')
    for k, v in pred_counts.most_common():
        print(f'  {k}: {v}')

# Reference analysis
referenced = set()
if os.path.exists(rel_dir):
    for f in os.listdir(rel_dir):
        if f.endswith('.json'):
            data = json.load(open(os.path.join(rel_dir, f), encoding='utf-8'))
            content = data.get('content', '')
            if isinstance(content, dict):
                for key in ['subject', 'object']:
                    v = content.get(key, '')
                    if v:
                        referenced.add(v)

orphans = sku_ids - referenced
non_rel_orphans = [o for o in orphans if 'relational' not in o]
print(f'\n=== Orphan Analysis ===')
print(f'Total SKUs: {len(skus)}')
print(f'Unique referenced IDs: {len(referenced)}')
print(f'Orphan SKUs (not in any relationship): {len(non_rel_orphans)}')
if non_rel_orphans:
    cls_orphan = Counter()
    for oid in non_rel_orphans:
        s = next(x for x in skus if x['sku_id'] == oid)
        cls_orphan[s.get('classification','?')] += 1
    for k, v in cls_orphan.most_common():
        print(f'  {k} orphans: {v}/{cls[k]}')

# Thin SKU analysis (P1 validation)
factual = [s for s in skus if s.get('classification') == 'factual']
thin = [s for s in factual if s.get('character_count', 0) < 100]
very_thin = [s for s in factual if s.get('character_count', 0) < 80]
print(f'\n=== Thin SKU Analysis ===')
print(f'Factual SKUs: {len(factual)}')
print(f'< 100 chars: {len(thin)} ({len(thin)*100//len(factual)}%)')
print(f'< 80 chars: {len(very_thin)}')
