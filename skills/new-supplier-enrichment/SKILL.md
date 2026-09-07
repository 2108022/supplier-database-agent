---
name: new-supplier-enrichment
description: Research and populate database-ready base information for new legal entities, plant-site records, and R&D-site records after supplier matching determines the target database record does not yet exist.
---

# New Supplier Enrichment

## Trigger

Use this skill ONLY when database-enrichment has determined:

`NeedNewSupplier = YES`

Supported internal record types:
- LEGAL_ENTITY
- PLANT_SITE
- RND_SITE

Do not run this skill for records already confirmed in supplier_master.

## Required inputs

- target StandardSiteName / supplier record name
- LegalEntityName
- RecordType
- site address and geography from the combined research skill
- MainProduct / R&D scope from the combined research skill
- verified sources already collected
- `references/new_supplier_import_template.xlsx` field structure as inspected by Codex
- rules in `references/base_information_rules.md`

## Core principle

All facts must belong to the exact target record and underlying legal entity.

Never copy group-level or parent-company facts into a subsidiary/site merely because the group controls it.

## Record-type behavior

### LEGAL_ENTITY

Research the exact registered legal entity and populate applicable corporate fields according to `base_information_rules.md`.

### PLANT_SITE

The database record represents an additional production-site node, not necessarily a separate legal entity.

Use:
- StandardSiteName as the new supplier/site record name
- the plant's actual address/geography
- plant-level products where supported
- ParentLegalEntity = verified operating legal entity

Do NOT invent or inherit as site-specific facts:
- CRN
- TIN
- registered capital
- CEO
- legal representative
- legal-entity employee total

unless the import schema explicitly defines inheritance or the site is itself a separately registered legal entity.

### RND_SITE

Same principle as PLANT_SITE, but use the R&D site's actual address and verified R&D scope.

Do not copy parent legal-entity registration fields into a non-legal R&D node.

## Field mapping

The actual output columns are dictated by `new_supplier_import_template.xlsx`.

At initialization, Codex must inspect the template and create a field mapping from canonical research fields to actual template columns.

Do not add unsupported columns to the formal import workbook.

Any auxiliary evidence/status fields belong in Review, not the formal import sheet.

## Missing values

If reliable information cannot be confirmed, leave the formal import cell blank unless the template explicitly requires a fixed missing-value marker.

Record the reason in Review as one of:
- 未公开
- 未找到可靠公开信息
- 待确认

Never fabricate values.

## DataType

DataType for LEGAL_ENTITY / PLANT_SITE / RND_SITE must follow an actual successful database example or explicit database rule.

If PLANT_SITE or RND_SITE DataType is still unknown, mark the record `REVIEW_REQUIRED` for formal import rather than guessing.

## Final QA

Before passing data back to database-enrichment, run all applicable checks in `references/base_information_rules.md` and verify:
- exact target identity
- exact legal entity
- correct address
- no parent/group data leakage
- no unsupported product inference
- no CRN/TIN confusion
- no ownership overstatement
