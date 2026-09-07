---
name: database-enrichment
description: Convert combined production-base and R&D-center research results into database-ready import records using supplier matching, region ID mapping, new site creation, bilingual expansion, QA, and Excel export.
---

# Database Enrichment

Use after the combined research skill.

Required stages:
1. normalize research result into research.json
2. resolve legal entity and site relationship
3. build StandardSiteName
4. map textual geography to region_master IDs using id/level/parentid/areacode/internalprimarykey
5. match StandardSiteName against supplier_master by entity identity, not raw string equality
6. preserve exact database SupplierName when an existing record is confirmed
7. decide NeedNewSupplier and RecordType
8. for every NeedNewSupplier=YES record, follow `references/new_supplier_handoff.md` and execute `skills/new-supplier-enrichment/SKILL.md`
9. expand LanguageType 0/1/8
10. QA before export
11. export formal production/R&D/new-supplier import files and Review

Shared implementation contract:
- use `scripts/run-company.js` and the schemas under `schemas/`
- support named-stage execution and one `record_id` partial rerun
- load/index each master once per process and use independently invalidated caches
- use `config/template-profile.json` for actual Sheet/column mappings and DataType evidence
- dry-run must not load Excel templates
- the Excel exporter may consume only QA-approved structured data and may not redo research or entity/region decisions

Critical:
- additional site records must never be downgraded to the parent legal entity.
- generic industry words plus a shared city are not sufficient identity evidence; name identity remains mandatory even when region/product evidence agrees.
- do not enrich all records with corporate base information; run new-supplier-enrichment only for missing records.
- do not re-research facts already supported by the combined research skill.
