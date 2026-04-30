import json, re
from collections import Counter

base = r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus'

# Load index
idx = json.load(open(r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus\skus_index.json', encoding='utf-8'))
skus = idx['skus']
factual_ids = set(s['sku_id'] for s in skus if s.get('classification') == 'factual')
procedural_ids = set(s['sku_id'] for s in skus if s.get('classification') == 'procedural')

# Load actual relationships
rels = json.load(open(r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus\relational\relationships.json', encoding='utf-8'))
rel_entries = rels['entries']

# Get all referenced subjects/objects
referenced = set()
for r in rel_entries:
    referenced.add(r['subject'])
    referenced.add(r['object'])

# Match referenced names to SKU ids/names
sku_names = {}
for s in skus:
    sku_names[s['name']] = s['sku_id']
    sku_names[s['sku_id']] = s['sku_id']

# Check how many relational subjects/objects match existing SKUs
matched_rel = 0
unmatched_rel = 0
for r in rel_entries:
    if r['subject'] in sku_names or r['object'] in sku_names:
        matched_rel += 1
    else:
        unmatched_rel += 1

print('=== Relational Matching ===')
print(f'Total relationships: {len(rel_entries)}')
print(f'Relationships with at least one end matching a SKU: {matched_rel}')
print(f'Relationships with no ends matching SKUs: {unmatched_rel}')

# Predicate distribution
pred_dist = Counter(r['predicate'] for r in rel_entries)
print(f'\n=== Predicate Distribution ===')
for k, v in pred_dist.most_common():
    pct = v * 100 / len(rel_entries)
    print(f'  {k}: {v} ({pct:.1f}%)')

# superset-of analysis
superset_rels = [r for r in rel_entries if r['predicate'] == 'superset-of']
print(f'\n=== superset-of Analysis ===')
print(f'Count: {len(superset_rels)} / {len(rel_entries)} = {len(superset_rels)*100/len(rel_entries):.1f}%')

# is-a analysis
is_a_rels = [r for r in rel_entries if r['predicate'] == 'is-a']
print(f'is-a: {len(is_a_rels)}')
for r in is_a_rels:
    print(f'  {r["subject"]} -> {r["object"]}')

# Cross-chunk relationship analysis
cross_chunk = 0
for r in rel_entries:
    chunks = r.get('source_chunks', [])
    if isinstance(chunks, list) and len(chunks) >= 1:
        # Check if all chunks are the same or different
        unique_chunks = set(chunks)
        if len(unique_chunks) >= 2:
            cross_chunk += 1
print(f'\nCross-chunk relationships (2+ unique sources): {cross_chunk}')

# Orphan analysis using actual relationship subjects/objects
# A SKU is "orphaned" if its name doesn't appear as subject or object in any relationship
orphan_factual = []
orphan_procedural = []
for s in skus:
    if s.get('classification') == 'factual':
        if s['name'] not in referenced:
            orphan_factual.append(s['name'])
    elif s.get('classification') == 'procedural':
        if s['name'] not in referenced:
            orphan_procedural.append(s['name'])

print(f'\n=== Orphan Analysis (name-based matching) ===')
print(f'Factual orphans: {len(orphan_factual)}/{len(factual_ids)} ({len(orphan_factual)*100//max(len(factual_ids),1)}%)')
print(f'Procedural orphans: {len(orphan_procedural)}/{len(procedural_ids)} ({len(orphan_procedural)*100//max(len(procedural_ids),1)}%)')
