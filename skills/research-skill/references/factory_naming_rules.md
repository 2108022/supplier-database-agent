# Factory Naming Rules

## 1. Legal entity is mandatory
Every production base must be attached to a verified legal entity. Do not use a city/site label alone when the operating legal entity can be confirmed.

## 2. Direct main / sole plant
If the legal entity itself corresponds to its direct main plant or sole confirmed production site, use the legal entity name only.

Example:
Brose Sitech GmbH

Do not rewrite it as:
Brose Sitech GmbH-Wolfsburg Plant
when Wolfsburg is the entity's direct/main site.

## 3. Additional plant under the same legal entity
If the same legal entity operates multiple plants, keep the headquarters/main plant as the legal entity name. Additional plants must use:

LegalEntityName-OfficialPlantName

If there is no official plant name, use:

LegalEntityName-City Plant

Example:
Proseat GmbH & Co. KG-Schwarzheide Plant

## 4. China
For Chinese companies, use the official Chinese registered legal name in Chinese-language output.

Additional Chinese plant:
中文法定公司名-城市工厂

For English-language output, use the official English legal name and official English plant/site name where available.

## 5. Non-China
Do not translate non-China legal entity names into Chinese. Do not create mixed names such as Berlin工厂. Use Berlin Plant or the official plant name.

## 6. Official name priority
When an official plant/site name exists, prefer it over an invented city-based name.

## 7. No parent downgrade
An additional site name must not be collapsed back to the parent legal entity during later database matching.

Example:
Proseat GmbH & Co. KG-Schwarzheide Plant
must remain a site-level record unless the database already contains the same site under another proven-equivalent canonical name.

## 8. Closed / sold / transferred sites
Do not treat closed, sold, transferred, or divested sites as active current production bases unless the user explicitly requests historical data. Flag them separately when relevant.
