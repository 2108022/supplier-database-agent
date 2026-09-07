# R&D Center Rules

## Inclusion
Classify a location as an R&D Center when reliable evidence explicitly supports one or more of:
- research
- development
- engineering
- technical development
- software development
- testing
- validation
- technology / innovation development

## Exclusion
Do not classify a pure sales office, administrative office, warehouse, training center, distribution center, or service center as R&D unless explicit R&D/testing/engineering functions are also confirmed.

## Naming
1. Direct/main R&D site of a legal entity: use LegalEntityName when the entity itself represents that site.
2. Additional R&D site with official name: LegalEntityName-OfficialR&DName.
3. Additional R&D site without official name: LegalEntityName-City R&D Center.
4. China: Chinese-language output uses official Chinese legal name; additional site may use 中文法定公司名-城市研发中心.
5. Non-China legal entity names are not translated into Chinese.

## Output
Provide both:
- SimplifiedR&DScope
- DetailedR&DScope

SimplifiedR&DScope should be concise and database-friendly.
DetailedR&DScope should preserve the finest explicitly verified development/testing content.

## Dual-function sites
A physical location may appear in both Production Base and R&D Center datasets if both functions are supported by evidence.
