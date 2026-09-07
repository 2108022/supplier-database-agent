# Supplier Database Agent V2.2

Default user input is one company name.

Workflow:
combined research skill -> research.json -> normalization -> region mapping -> supplier matching -> new record decisions -> new supplier enrichment (only for missing records) -> language expansion -> QA -> Excel export.

The shared executable contract is:
`work/<company>/research.json -> normalized.json -> region_matches.json -> supplier_matches.json -> new_supplier_requests.json/new_supplier_enrichment.json -> qa.json -> Excel export`.

Use `scripts/run-company.js`; it supports named stages and `--record-id` partial reruns. A dry run must complete data decisions and QA without loading any Excel import template. The export stage consumes `qa.json` only: it must not browse, research, rematch suppliers, or remap regions.

The research skill is one combined Production Base + R&D Center skill.

Never create company-specific matcher/build scripts. Company facts belong in work/<company>/research.json, not source code.

Supplier and region masters must each be loaded/indexed at most once per process. Their disk caches are independently invalidated by source size/mtime and verified hash. Region lookup must expose byId, byParent, byAreaCode, and byNormalizedName indexes and reuse identical hierarchy queries. Alias/reviewed history sources that exist must be attached to the shared supplier index.

If a record is ambiguous, send it to Review and continue other records.

Do not modify files under references/.

Before each company run, read:
- skills/research-skill/SKILL.md
- all files under skills/research-skill/references/
- skills/database-enrichment/SKILL.md
- skills/database-enrichment/references/new_supplier_handoff.md

Only when `NeedNewSupplier = YES`, additionally read and execute:
- skills/new-supplier-enrichment/SKILL.md
- skills/new-supplier-enrichment/references/base_information_rules.md

Important separation:
- research-skill finds and verifies production/R&D sites and their products/functions.
- database-enrichment performs site naming, supplier matching, region IDs, language expansion, import decisions, and QA.
- new-supplier-enrichment researches missing supplier/site base information only for records that truly need creation.

Reuse evidence already collected by research-skill. Do not repeat web/PDF research unless a required new-supplier field is missing or evidence is insufficient.

Unresolved project-level requirement:
The exact DataType value for new PLANT_SITE and RND_SITE records must be learned from a valid database example or explicit user/database rule. Do not guess it.

The evidence-backed DataType registry and canonical-to-template mapping live in `config/template-profile.json`. QA must keep any unresolved DataType record out of formal import workbooks.

## Rule Update Protocol

When the user supplies a new or corrected business rule:
1. Treat the latest explicit user rule as authoritative.
2. Identify the smallest appropriate permanent rule/skill file to update.
3. Do not duplicate the same rule across multiple files unless a cross-reference is genuinely needed.
4. If deterministic behavior changes, add or update regression tests.
5. Add an entry to CHANGELOG.md and bump VERSION appropriately.
6. Do not rewrite unrelated rules.
7. If the new rule conflicts with an older rule, replace/deprecate the older rule instead of preserving contradictory rules.
8. Never require the user to re-upload the whole specification when the repository already contains it.
9. Never implement a general rule through company-specific code.
