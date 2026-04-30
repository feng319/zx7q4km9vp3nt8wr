import json, os, re
from collections import Counter

base = r'c:\Users\56839\.claude\skills\Anything2Ontology\output\skus\relational'

for f in sorted(os.listdir(base)):
    fp = os.path.join(base, f)
    print(f'=== {f} ===')
    if f.endswith('.json'):
        try:
            d = json.load(open(fp, encoding='utf-8'))
            if isinstance(d, dict):
                print(f'  Keys: {list(d.keys())}')
                entries = d.get('entries', [])
                print(f'  Entries: {len(entries)}')
                if entries and isinstance(entries[0], dict):
                    print(f'  First entry keys: {list(entries[0].keys())}')
                    # For relationships, count predicates
                    if 'predicate' in entries[0]:
                        preds = Counter(e.get('predicate','?') for e in entries)
                        print(f'  Predicates:')
                        for k, v in preds.most_common():
                            print(f'    {k}: {v}')
                    elif 'term' in entries[0]:
                        # Glossary
                        print(f'  Sample terms: {[e["term"] for e in entries[:3]]}')
            elif isinstance(d, list):
                print(f'  Array length: {len(d)}')
        except Exception as ex:
            print(f'  Error: {ex}')
    else:
        size = os.path.getsize(fp)
        print(f'  Size: {size} bytes (not JSON)')
    print()
