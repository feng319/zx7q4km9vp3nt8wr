"""Cross-document relation discovery postprocessor.

Discovers implicit relationships between entities across different document
chunks using entity disambiguation, transitive inference, and LLM verification.

Steps:
1. Entity disambiguation — unify aliases via glossary (VPP -> 虚拟电厂)
2. Candidate inference — generate transitive candidates (A->B + B->C => A->C)
3. LLM verification — validate candidates against domain knowledge (parallel batches)
4. Write — deduplicate and persist new relationships
"""

import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.schemas.sku import (
    Glossary,
    GlossaryEntry,
    Relationship,
    RelationType,
    Relationships,
)
from chunks2skus.utils.llm_client import call_llm_json

from .base import BasePostprocessor

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# LLM Prompts
# ---------------------------------------------------------------------------

VERIFY_RELATIONS_PROMPT = {
    "zh": '''你是一位领域知识图谱专家。请验证以下候选关系是否成立。

已有知识库中的关系（上下文）：
{existing_relations}

已有术语表：
{glossary_summary}

候选关系（待验证）：
{candidates}

任务：
对每个候选关系，判断它是否在领域知识中合理成立。
仅保留有充分依据的关系（领域知识、常识推理、逻辑推导均认可）。
删除以下类型的关系：
- 跨领域的不合理关联（如"电力市场 causes 人工智能"）
- 过于模糊的关系（两个概念确实相关但关系类型不明确）
- 已有关系的语义重复（换了个谓词但含义相同）

仅输出合法 JSON：
{{
  "accepted": [
    {{"subject": "A", "predicate": "causes", "object": "B", "reasoning": "简要理由", "confidence": 4}}
  ],
  "rejected": [
    {{"subject": "A", "predicate": "causes", "object": "B", "reasoning": "拒绝理由"}}
  ]
}}

合法谓词： "is-a", "has-a", "part-of", "causes", "caused-by", "requires", "enables", "contradicts", "related-to", "depends-on", "regulates", "implements", "example-of", "certifies", "superset-of"

confidence: 整数1-5（1=推测性，5=明确陈述）。不确定时可省略。
''',
    "en": '''You are a domain knowledge graph expert. Please verify whether the following candidate relationships hold.

Existing relationships in the knowledge base (context):
{existing_relations}

Existing glossary:
{glossary_summary}

Candidate relationships (to verify):
{candidates}

TASK:
For each candidate relationship, determine whether it is valid in the domain knowledge.
Only keep relationships that are well-supported (by domain knowledge, common sense, or logical inference).
Reject the following:
- Unreasonable cross-domain associations (e.g., "Electricity Market causes Artificial Intelligence")
- Overly vague relationships (concepts are related but the relationship type is unclear)
- Semantic duplicates of existing relationships (different predicate but same meaning)

Output ONLY valid JSON:
{{
  "accepted": [
    {{"subject": "A", "predicate": "causes", "object": "B", "reasoning": "Brief reasoning", "confidence": 4}}
  ],
  "rejected": [
    {{"subject": "A", "predicate": "causes", "object": "B", "reasoning": "Rejection reason"}}
  ]
}}

Valid predicates: "is-a", "has-a", "part-of", "causes", "caused-by", "requires", "enables", "contradicts", "related-to", "depends-on", "regulates", "implements", "example-of", "certifies", "superset-of"

confidence: integer 1-5 (1=speculative, 5=explicitly stated). Omit if unsure.
''',
}


class CrossDocRelationsPostprocessor(BasePostprocessor):
    """Discover cross-document relationships via entity disambiguation
    and transitive inference."""

    step_name = "cross_doc_relations"

    # Predicates eligible for transitive inference
    # e.g., A causes B, B causes C => A causes C
    TRANSITIVE_PREDICATES = {
        "causes", "caused-by", "requires", "depends-on",
        "part-of", "superset-of", "enables", "regulates",
    }

    # Maximum candidates per LLM verification batch
    MAX_CANDIDATES_PER_BATCH = 40

    # Maximum concurrent batch verification workers
    MAX_BATCH_WORKERS = 8

    # Maximum existing relations to include as context
    MAX_CONTEXT_RELATIONS = 60

    # Maximum glossary entries to include as context
    MAX_GLOSSARY_SUMMARY = 3000

    def run(self, **kwargs: Any) -> Any:
        """Run cross-document relation discovery.

        Returns:
            CrossDocRelationResult with statistics and accepted relations.
        """
        from chunks2skus.schemas.postprocessing import CrossDocRelationResult

        logger.info(
            "Starting cross-document relation discovery",
            skus_dir=str(self.skus_dir),
        )

        # 1. Load relational data
        relationships = self._load_relationships()
        glossary = self._load_glossary()

        if len(relationships.entries) < 2:
            logger.info(
                "Too few existing relationships for cross-doc discovery, skipping",
                count=len(relationships.entries),
            )
            return CrossDocRelationResult(
                total_candidates=0,
                total_accepted=0,
                total_rejected=0,
                total_existing=len(relationships.entries),
            )

        # 2. Entity disambiguation — build unified name mapping
        unified_map = self._build_unified_name_map(glossary)
        logger.info(
            "Built unified name map",
            unique_entities=len(unified_map),
        )

        # 3. Apply disambiguation to existing relationships
        unified_rels = self._unify_relationships(relationships, unified_map)

        # 4. Generate transitive candidates
        candidates = self._generate_transitive_candidates(unified_rels)
        logger.info(
            "Generated transitive candidates",
            candidates=len(candidates),
        )

        if not candidates:
            logger.info("No transitive candidates generated")
            return CrossDocRelationResult(
                total_candidates=0,
                total_accepted=0,
                total_rejected=0,
                total_existing=len(relationships.entries),
            )

        # 5. Filter out candidates that already exist (exact or unified)
        candidates = self._filter_existing_candidates(
            candidates, relationships, unified_map
        )
        logger.info(
            "Candidates after filtering existing",
            candidates=len(candidates),
        )

        if not candidates:
            logger.info("All candidates already exist in relationships")
            return CrossDocRelationResult(
                total_candidates=0,
                total_accepted=0,
                total_rejected=0,
                total_existing=len(relationships.entries),
            )

        # 6. LLM verification in parallel batches
        # Each batch reads the same relationships/glossary snapshot (loaded once),
        # so batches are completely independent — safe to parallelize.
        total_candidates = len(candidates)
        accepted_rels: list[Relationship] = []
        total_rejected = 0

        batches = self._split_batches(candidates)
        logger.info(
            "Starting parallel batch verification",
            total_batches=len(batches),
            batch_size=self.MAX_CANDIDATES_PER_BATCH,
            workers=self.MAX_BATCH_WORKERS,
        )

        with ThreadPoolExecutor(max_workers=self.MAX_BATCH_WORKERS) as executor:
            futures = {
                executor.submit(
                    self._verify_batch, batch, relationships, glossary
                ): i
                for i, batch in enumerate(batches)
            }
            for future in as_completed(futures):
                batch_idx = futures[future]
                try:
                    batch_accepted, batch_rejected = future.result()
                    accepted_rels.extend(batch_accepted)
                    total_rejected += batch_rejected
                    logger.info(
                        "Batch verification complete",
                        batch_idx=batch_idx + 1,
                        total_batches=len(batches),
                        accepted=len(batch_accepted),
                        rejected=batch_rejected,
                    )
                except Exception as e:
                    logger.error(
                        "Batch verification failed",
                        batch_idx=batch_idx + 1,
                        error=str(e),
                    )

        # 7. Write accepted relationships
        new_count = 0
        for rel in accepted_rels:
            before = len(relationships.entries)
            relationships.add(rel)
            after = len(relationships.entries)
            if after > before:
                new_count += 1

        # Save updated relationships
        self._save_relationships(relationships)

        # 8. Save result
        result = CrossDocRelationResult(
            total_candidates=total_candidates,
            total_accepted=new_count,
            total_rejected=total_rejected,
            total_existing=len(relationships.entries),
        )
        self._save_result(result)

        logger.info(
            "Cross-document relation discovery complete",
            total_candidates=total_candidates,
            accepted=new_count,
            rejected=total_rejected,
            total_relationships=len(relationships.entries),
        )

        return result

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------

    def _load_relationships(self) -> Relationships:
        """Load relationships.json from relational SKU dir."""
        path = self.skus_dir / "relational" / "relationships.json"
        if not path.exists():
            logger.warning("relationships.json not found", path=str(path))
            return Relationships()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return Relationships.model_validate(data)
        except Exception as e:
            logger.warning("Failed to load relationships", error=str(e))
            return Relationships()

    def _load_glossary(self) -> Glossary:
        """Load glossary.json from relational SKU dir."""
        path = self.skus_dir / "relational" / "glossary.json"
        if not path.exists():
            logger.warning("glossary.json not found", path=str(path))
            return Glossary()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return Glossary.model_validate(data)
        except Exception as e:
            logger.warning("Failed to load glossary", error=str(e))
            return Glossary()

    def _save_relationships(self, relationships: Relationships) -> None:
        """Save updated relationships to disk."""
        path = self.skus_dir / "relational" / "relationships.json"
        path.write_text(
            relationships.model_dump_json(indent=2), encoding="utf-8"
        )
        logger.info("Saved updated relationships", path=str(path))

    def _save_result(self, result: Any) -> None:
        """Save result to postprocessing directory."""
        path = self.postprocessing_dir / "cross_doc_relations_result.json"
        path.write_text(
            result.model_dump_json(indent=2), encoding="utf-8"
        )

    # ------------------------------------------------------------------
    # Step 1: Entity disambiguation
    # ------------------------------------------------------------------

    def _build_unified_name_map(self, glossary: Glossary) -> dict[str, str]:
        """Build a mapping from all name variants to the canonical term.

        Returns dict: lowercase variant -> canonical term (original case).
        """
        mapping: dict[str, str] = {}
        for entry in glossary.entries:
            canonical = entry.term
            # Map canonical term to itself
            mapping[canonical.lower()] = canonical
            # Map all aliases to canonical term
            for alias in entry.aliases:
                if alias and alias.lower() != canonical.lower():
                    mapping[alias.lower()] = canonical
            # Map related terms to canonical term (softer link)
            for rt in entry.related_terms:
                if rt and rt.lower() not in mapping:
                    mapping[rt.lower()] = rt  # Keep related term's own name
        return mapping

    def _unify_name(self, name: str, unified_map: dict[str, str]) -> str:
        """Unify a name using the alias map. Returns unified name."""
        lower = name.lower()
        return unified_map.get(lower, name)

    def _unify_relationships(
        self, rels: Relationships, unified_map: dict[str, str]
    ) -> list[tuple[str, str, str]]:
        """Return list of (unified_subject, predicate, unified_object)."""
        result = []
        for rel in rels.entries:
            subj = self._unify_name(rel.subject, unified_map)
            obj = self._unify_name(rel.object, unified_map)
            pred = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
            result.append((subj, pred, obj))
        return result

    # ------------------------------------------------------------------
    # Step 2: Transitive candidate generation
    # ------------------------------------------------------------------

    def _generate_transitive_candidates(
        self, unified_rels: list[tuple[str, str, str]]
    ) -> list[tuple[str, str, str]]:
        """Generate candidate (subject, predicate, object) from transitive
        patterns in existing relationships.

        For transitive predicates: if A pred B and B pred C, candidate A pred C.
        Also: if A pred1 B and B pred2 C, candidate A related-to C (weaker).
        """
        # Build adjacency: subject -> [(predicate, object), ...]
        adj: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for subj, pred, obj in unified_rels:
            adj[subj].append((pred, obj))

        candidates: set[tuple[str, str, str]] = set()

        # For each pair (A, B) where A pred1 B:
        for a, (pred1, b) in adj.items():
            for pred2, c in adj.get(b, []):
                # Skip self-loops
                if a.lower() == c.lower():
                    continue

                if pred1 == pred2 and pred1 in self.TRANSITIVE_PREDICATES:
                    # Same transitive predicate: A pred B, B pred C => A pred C
                    candidates.add((a, pred1, c))
                else:
                    # Different predicates or non-transitive:
                    # Only generate for strong connections
                    if (pred1 in self.TRANSITIVE_PREDICATES
                            and pred2 in self.TRANSITIVE_PREDICATES):
                        candidates.add((a, "related-to", c))

        return list(candidates)

    # ------------------------------------------------------------------
    # Step 3: Filter existing
    # ------------------------------------------------------------------

    def _filter_existing_candidates(
        self,
        candidates: list[tuple[str, str, str]],
        relationships: Relationships,
        unified_map: dict[str, str],
    ) -> list[tuple[str, str, str]]:
        """Remove candidates that already exist (exact or via alias unification)."""
        existing: set[tuple[str, str, str]] = set()
        for rel in relationships.entries:
            pred = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
            existing.add((
                rel.subject.lower(), pred, rel.object.lower()
            ))

        filtered = []
        for subj, pred, obj in candidates:
            key = (subj.lower(), pred, obj.lower())
            if key not in existing:
                filtered.append((subj, pred, obj))
        return filtered

    # ------------------------------------------------------------------
    # Step 4: LLM verification
    # ------------------------------------------------------------------

    def _split_batches(
        self, candidates: list[tuple[str, str, str]]
    ) -> list[list[tuple[str, str, str]]]:
        """Split candidates into batches for LLM verification."""
        batches = []
        for i in range(0, len(candidates), self.MAX_CANDIDATES_PER_BATCH):
            batches.append(candidates[i:i + self.MAX_CANDIDATES_PER_BATCH])
        return batches

    def _verify_batch(
        self,
        batch: list[tuple[str, str, str]],
        relationships: Relationships,
        glossary: Glossary,
    ) -> tuple[list[Relationship], int]:
        """Verify a batch of candidates with LLM. Returns (accepted, rejected)."""
        lang = settings.language

        # Format existing relations as context
        existing_lines = []
        for rel in relationships.entries:
            pred = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
            existing_lines.append(f"- {rel.subject} {pred} {rel.object}")
            if len(existing_lines) >= self.MAX_CONTEXT_RELATIONS:
                existing_lines.append(f"  ... (truncated, {len(relationships.entries)} total)")
                break
        existing_relations = "\n".join(existing_lines) if existing_lines else "(无)"

        # Format glossary summary
        glossary_lines = []
        total_chars = 0
        for entry in glossary.entries:
            line = f"- {entry.term}"
            if entry.aliases:
                line += f" (别名: {', '.join(entry.aliases)})"
            if entry.definition:
                line += f": {entry.definition[:80]}"
            if total_chars + len(line) + 1 > self.MAX_GLOSSARY_SUMMARY:
                break
            glossary_lines.append(line)
            total_chars += len(line) + 1
        glossary_summary = "\n".join(glossary_lines) if glossary_lines else "(无)"

        # Format candidates
        candidate_lines = []
        for subj, pred, obj in batch:
            candidate_lines.append(f"- {subj} {pred} {obj}")
        candidates_text = "\n".join(candidate_lines)

        prompt = VERIFY_RELATIONS_PROMPT[lang].format(
            existing_relations=existing_relations,
            glossary_summary=glossary_summary,
            candidates=candidates_text,
        )

        parsed = call_llm_json(prompt, max_tokens=32000)
        if not parsed:
            logger.warning("LLM verification returned empty response")
            return [], len(batch)

        accepted: list[Relationship] = []
        rejected_count = 0

        # Process accepted
        for item in parsed.get("accepted", []):
            try:
                predicate_str = item.get("predicate", "related-to")
                try:
                    predicate = RelationType(predicate_str)
                except ValueError:
                    logger.warning(
                        "Unknown predicate in accepted candidate, falling back to related-to",
                        raw_predicate=predicate_str,
                    )
                    predicate = RelationType.RELATED_TO

                rel = Relationship(
                    subject=item["subject"],
                    predicate=predicate,
                    object=item["object"],
                    source_chunks=["cross-doc-discovery"],
                )
                # Map confidence 1-5 -> 0.2-1.0
                confidence_raw = item.get("confidence")
                if confidence_raw and isinstance(confidence_raw, (int, float)):
                    rel.confidence = max(0.2, min(1.0, float(confidence_raw) / 5.0))
                else:
                    rel.confidence = 0.4  # Default for inferred relations

                accepted.append(rel)
            except (KeyError, TypeError) as e:
                logger.warning(
                    "Failed to parse accepted candidate",
                    error=str(e),
                    item=item,
                )

        rejected_count = len(parsed.get("rejected", []))

        logger.info(
            "Batch verification complete",
            accepted=len(accepted),
            rejected=rejected_count,
        )

        return accepted, rejected_count
