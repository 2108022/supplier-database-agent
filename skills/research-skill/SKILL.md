---
name: automotive-production-base-research
description: Research, verify, standardize, supplement, and clean global automotive production base and R&D center data for automotive OEMs, suppliers, subsidiaries, and joint ventures.
---

# Automotive Production Base & R&D Center Research

## Purpose

Use this skill to research, verify, standardize, supplement, and clean global automotive production-base and R&D-center data.

The skill is intended for automotive OEMs, suppliers, electronics companies, materials companies, manufacturing groups, subsidiaries, and joint ventures.

## When to use

Use this skill when the user asks to:

- 整理或补充某公司的全球生产基地
- 核验某地点是否属于真实生产工厂
- 核验注册法人名称与工厂之间的关系
- 查找遗漏工厂或研发中心
- 统一生产基地或研发中心命名
- 区分主工厂与额外厂区
- 核验生产产品或研发内容
- 处理生产基地 Excel、PDF、网页数据
- 删除重复、已关闭、已出售或错误归属基地
- 统一国家与多级行政区划

## Core entity model

Treat the data hierarchy as:

Group → Legal Entity → Production Base / R&D Center → Product / R&D Scope

Do not assume that a company name is automatically a factory name.

## Required workflow

1. Identify the group and the formal legal entity.
2. Verify whether the location has manufacturing, R&D, engineering, testing, or validation functions.
3. Classify manufacturing locations as Production Base.
4. Classify R&D, engineering, testing, or validation locations as R&D Center.
5. If a location performs both production and R&D functions, it may appear in both datasets.
6. Determine whether the legal entity operates one production site or multiple production sites.
7. Apply the production-base naming rules in `references/factory_naming_rules.md`.
8. Standardize geographic hierarchy using `references/geographic_rules.md`.
9. Produce both simplified and detailed product fields using `references/product_rules.md`.
10. For R&D centers, produce simplified and detailed R&D scopes using `references/rd_center_rules.md`.
11. Verify operating status and remove or flag closed, sold, transferred, duplicate, or non-relevant sites.
12. Use source hierarchy and conflict rules in `references/source_priority.md`.
13. Run final checks in `references/quality_checks.md` before output.
14. Save structured facts to `work/<company>/research.json` using `schemas/research.schema.json`; use stable `record_id` values when available. Never generate a company-specific program.

## Classification rules

### Production Base

Include locations with explicit manufacturing or assembly functions, such as:

- production
- manufacturing
- manufacture
- plant
- factory
- production site
- manufacturing site
- assembly
- produces
- manufactures

### R&D Center

Include locations with explicit research, engineering, development, testing, or validation functions, such as:

- R&D Center
- Research Center
- Engineering Center
- Development Center
- Technical Center
- Technology Center
- Innovation Center
- Testing Center
- Test Center
- Validation Center
- Engineering Office
- Software Development Center

A site with both manufacturing and R&D functions may be classified in both categories.

### Exclusions

Do not include locations that only perform the following functions unless they also have confirmed production or R&D/testing functions:

- Sales Office
- Representative Office
- Warehouse
- Logistics Center
- Distribution Center
- Training Center
- Administrative Office
- After-sales Center

## Naming summary

The detailed naming rules are in `references/factory_naming_rules.md`.

Key rule:

- If the legal entity itself corresponds to the main production plant, use the legal entity name only.
- If the same legal entity has additional production sites, only the additional sites receive a plant suffix.
- For non-China sites, do not translate plant names into Chinese and do not use mixed forms such as `Berlin工厂`; use `Berlin Plant` or the official plant name.

## Recommended Production Base output fields

- Continent
- Country
- FirstAdministrativeDivision
- SecondAdministrativeDivision
- ThirdAdministrativeDivision
- LegalEntityName
- ProBaseName
- Address
- SimplifiedProduct
- DetailedProduct
- BusinessUnit
- PlantType
- Status
- EvidenceLevel
- Source
- Remark

## Recommended R&D Center output fields

- Continent
- Country
- FirstAdministrativeDivision
- SecondAdministrativeDivision
- ThirdAdministrativeDivision
- LegalEntityName
- R&D Center Name
- Address
- SimplifiedR&DScope
- DetailedR&DScope
- R&DType
- Status
- EvidenceLevel
- Source
- Remark

## Rule priority

When rules conflict, apply this priority:

1. The user's current explicit instruction
2. The user's project-specific data standard
3. This skill's rules
4. The latest reliable official information
5. Default industry judgment

New user rules should be treated as updates that override conflicting older rules.
