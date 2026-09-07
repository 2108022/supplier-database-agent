# Quality Checks

Run before handing research results to database enrichment.

## Entity checks
1. Every site has a verified or explicitly unresolved LegalEntityName.
2. Group name is not used as legal entity unless it is the actual operating legal entity.
3. China uses official Chinese registered name for Chinese-language legal entity output.
4. Non-China legal entity names are not arbitrarily translated.

## Function checks
5. Production Base has explicit manufacturing/assembly evidence.
6. R&D Center has explicit R&D/engineering/testing/validation evidence.
7. Pure offices/warehouses/distribution sites are excluded unless qualifying functions are also confirmed.
8. Dual-function sites have evidence for both classifications.

## Naming checks
9. Direct/main/sole plant uses legal entity name only.
10. Additional plant includes legal entity prefix and official plant name or City Plant.
11. Additional R&D site includes legal entity prefix and official name or City R&D Center.
12. No bare Berlin Plant / Shanghai R&D Center without legal entity when the operating entity is known.

## Geography checks
13. Country is known.
14. Administrative levels are not guessed.
15. Ambiguous city names retain parent geographic context.
16. Site address belongs to the site, not merely the parent company HQ.

## Product / R&D checks
17. Products are site-specific where possible.
18. Product fields do not contain brands/series/models as product categories.
19. Processes/services are not mislabeled as products.
20. R&D scope describes actual R&D/engineering/testing work.

## Status / duplicate checks
21. Closed/sold/transferred sites are excluded or clearly flagged.
22. Duplicate records representing the same physical site are merged.
23. Same legal entity + same site + same address should not be duplicated because of naming variants.
24. Material uncertainty is marked REVIEW_REQUIRED rather than guessed.
