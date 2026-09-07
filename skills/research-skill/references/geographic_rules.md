# Geographic Rules

## Goal
Standardize location facts before database ID mapping. Research-stage output should preserve textual geography; database IDs are assigned only in the enrichment stage from region_master.

## Required geographic fields
- Country
- FirstAdministrativeDivision
- SecondAdministrativeDivision
- ThirdAdministrativeDivision
- City / locality where applicable
- DetailedAddress when available

## Rules
1. Use the site's actual physical location, not the parent company's headquarters location.
2. Preserve the real administrative hierarchy used by the country; do not assume every second-level administrative unit is a city.
3. Do not invent missing administrative levels.
4. If an official source provides only country + city, keep unavailable levels blank rather than guessing.
5. Accept local-language and English geographic names as equivalent candidates only after verifying they refer to the same place.
6. Geographic names may differ from database names; enrichment must resolve them as geographic entities rather than by raw string equality.
7. Never generate database region IDs in the research skill.
8. For ambiguous place names, retain enough parent context (country / province / state / region) to permit deterministic mapping later.
9. Detailed address should be kept in the source language where possible; do not fabricate postcode or street address.
10. When a site moves, distinguish current from historical address.
