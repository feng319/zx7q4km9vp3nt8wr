"""Quick test: run pipeline on first 5 chunks only."""
from chunks2skus.pipeline import ExtractionPipeline
from chunks2skus.config import settings

# Override meta_interval for testing
settings.meta_interval = 5

p = ExtractionPipeline(force_reset=True)

# Load all chunks, keep only first 5
all_chunks = p.router.load_chunks(p.chunks_dir)
print(f"Total chunks available: {len(all_chunks)}")
print(f"Processing first 5 chunks only...")

# Monkey-patch the router to only return 5 chunks
original_load = p.router.load_chunks
p.router.load_chunks = lambda d: all_chunks[:5]

result = p.run()
print(f"\nDone! Total SKUs: {result.total_skus}")
