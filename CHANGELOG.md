# Changelog

## 2.3.0 - 2026-09-07
- Completed the first formal, company-agnostic project initialization.
- Identified the live supplier/region structures and all three Excel template schemas without changing reference files.
- Added canonical template mappings and evidence-backed DataType status (`LEGAL_ENTITY=0`; Site types unresolved).
- Added shared staged execution, single-record reruns, dry-run export planning, QA gating, and Excel rendering.
- Added independently invalidated supplier/region caches, persistent normalized supplier indexes, region hierarchy indexes, and manifest timing/cache statistics.
- Connected reviewed supplier-name history from the production template's auxiliary sheet.
- Added regression tests for entity, Site, region-language, new-supplier, QA, cache, and export rules.
- Expanded Git ignore protection for all local master data, templates, runtime artifacts, dependencies, and machine-local configuration.

## 2.2.0
- Combined production-base + R&D research skill retained as one skill.
- Added database enrichment layer.
- Added new-supplier enrichment layer.
- Added local-only reference-data convention.
- Added Git/GitHub maintenance workflow.
