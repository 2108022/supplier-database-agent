# New Supplier Handoff Contract

When supplier matching yields `NeedNewSupplier = YES`:

1. Freeze the match decision and target StandardSiteName.
2. Assign internal RecordType:
   - LEGAL_ENTITY
   - PLANT_SITE
   - RND_SITE
3. Call `skills/new-supplier-enrichment/SKILL.md`.
4. Pass existing verified research evidence so the new-supplier skill reuses it instead of starting from zero.
5. Research only missing base-information fields.
6. Map canonical fields to the real `new_supplier_import_template.xlsx` columns discovered during initialization.
7. Return a structured new-supplier record plus evidence/QA metadata.
8. If the new-supplier skill discovers an existing database record, stop new creation and return to supplier matching.
9. If DataType for PLANT_SITE/RND_SITE is unresolved, put the record in Review and do not guess.
10. Formal Excel export happens only after new-supplier QA passes.
