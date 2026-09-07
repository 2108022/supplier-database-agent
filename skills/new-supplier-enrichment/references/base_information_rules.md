# 新增供应商基础信息收集规则

## 1. 任务目标

对 `NeedNewSupplier = YES` 的目标记录逐条独立检索、核验和整理，使其能够进入 `new_supplier_import_template.xlsx`。

必须落到具体目标记录和对应注册法人，不得把集团、母公司、品牌、其他工厂、分公司或关联公司的数据错误套用。

如果目标是额外 PLANT_SITE / RND_SITE，必须区分“数据库中的 Site 节点”和“实际注册法人”。

---

## 2. 法人确认

优先确认正式注册法人名称，来源优先：
1. 公司注册机构登记名称
2. 官方网站 Legal Entity 名称
3. 官方年报 / SEC / 注册资料
4. 官方认证证书

品牌、集团名、工厂名不是当然的法人名。

Branch / Oddział / 分公司等不得自动视为独立法人。

公司正式更名时保存 Current Legal Name，并在 Review 中记录 Former Legal Name 和更名证据。

---

## 3. 来源优先级

按以下顺序：
1. 公司官方网站
2. 集团官方网站
3. 公司年报 / 财务报表 / ESG 报告
4. SEC / 上市公司监管披露
5. 当地政府工商注册机构
6. 税务机关
7. 政府投资 / 产业机构
8. IATF / ISO / UL 等官方认证文件
9. 当地劳动、环保、海关、外资登记等政府资料
10. 可靠企业数据库
11. 可靠第三方商业数据库

注册号、税号、注册资本、董事、法定代表人、成立日期等优先政府或官方注册来源。

---

## 4. 禁止事项

不得：
- 根据行业常识猜产品
- 根据客户推断产品
- 根据经营范围直接推断实际生产产品
- 把集团产品全部套到某个法人/工厂
- 把进口产品当自产产品
- 把集团 CEO 自动填给子公司
- 把集团员工数填给单个法人
- 把新增就业人数当当前员工数
- 把历史员工人数当当前人数
- 把工厂监管编号误写为公司注册号
- 把品牌名称误认为法人
- 把母公司税号填给子公司
- 混淆集团持股与直接持股
- 仅因“集团控制”写成官方确认 100%
- 给非独立法人的 PLANT_SITE / RND_SITE 自动继承母公司 CRN、TIN、注册资本、CEO 等

无法确认时留空并在 Review 标记：未公开 / 未找到可靠公开信息 / 待确认。

---

## 5. Canonical 字段

研究层至少支持以下 Canonical 字段，正式导出时按真实模板映射：

- CompanyName
- CompanyAbbreviation
- FormerName
- LocationCountry
- Province
- City
- PostCode
- DetailedAddress
- WebSite
- Employees
- RegisterCapitalSum
- RegisterCapitalType
- RegisterCapitalUnit
- EstablishedDate
- CEO
- LegalRepresentative
- CRN
- TIN
- Phone
- Email
- ParentCompany
- Ownership
- UltimateOwnership
- FacilityType
- MainProductsCN
- MainProductsEN
- Notes

如果模板没有某字段，不得擅自增加到正式 Excel；可保留在 Review。

---

## 6. CompanyName

### LEGAL_ENTITY
使用正式法定注册名称。

### PLANT_SITE / RND_SITE
使用 database-enrichment 已生成的最终 StandardSiteName。

同时内部保留 `ParentLegalEntity`，但不要把 ParentLegalEntity 替换为 Site 的正式数据库记录名。

---

## 7. CompanyAbbreviation

简称不得只写品牌。

建议至少体现：
`品牌/公司 + 城市或州/省 + 国家或足够明确地区`

同一法人多个地点必须可区分。

仅在模板实际需要 CompanyAbbreviation 时填充。

---

## 8. 地址

尽量拆分：
- LocationCountry
- Province（一级行政区）
- City（实际城市或数据库要求的相应行政区）
- PostCode
- DetailedAddress

不能假设所有国家二级行政区都是城市。

正式导入的地区数字 ID 由 database-enrichment 的 region mapper 提供；本 Skill 不自行猜 ID。

---

## 9. Employees

优先：
1. 公司官网当前人数
2. 官方年报
3. ESG 报告
4. 政府劳动资料
5. 官方工厂介绍

必须区分：
- legal-entity employees
- plant employees
- group employees
- planned new jobs

非目标口径不得直接填入目标字段。

---

## 10. 注册资本

必须区分：
- Authorized Capital
- Paid-up Capital
- Registered Capital

不得把不同性质资本混成一个数字。

美国等没有统一“注册资本”概念的司法辖区，不人为换算；无可靠数据则留空并在 Review 说明 Not applicable / Not publicly disclosed。

---

## 11. EstablishedDate

优先法人正式注册成立日期，格式 `YYYY-MM-DD`。

必须区分：
- 集团成立年份
- 法人成立日期
- 工厂投产年份

PLANT_SITE / RND_SITE 如模板的成立日期语义实际指 Site Start Date，应按模板定义处理；不要把法人注册日与工厂投产日混用。

---

## 12. CEO / LegalRepresentative

区分：
- Group CEO
- Subsidiary CEO
- President
- Managing Director
- Representative Director
- Legal Representative
- Director

没有子公司级负责人时，不自动填集团 CEO。

非独立 Site 节点不得把母公司 CEO 当成 Site 独立 CEO，除非数据库字段定义就是“所属法人负责人”，并在映射规则中明确。

---

## 13. CRN

根据当地制度填写实际公司注册识别号，并在 Review 保存类型。

示例：
- India: CIN
- Slovakia: IČO
- United States: State Entity ID / Control Number（需注明类型）
- South Korea: Corporation Registration No.

Mexico 若没有可靠公司注册号，不得把 RFC 冒充 CRN。

非独立 PLANT_SITE / RND_SITE 不自动填写法人 CRN。

---

## 14. TIN

按国家使用对应税务识别号，例如：
- Mexico: RFC
- India: GSTIN / PAN
- United States: EIN
- Slovakia: DIČ / VAT ID
- Portugal: NIF / NIPC
- South Korea: Business Registration No.
- Morocco: ICE / IF
- South Africa: VAT / Tax No.

保留原始大小写和格式。

非独立 PLANT_SITE / RND_SITE 不自动填写母公司 TIN。

---

## 15. 电话与邮箱

优先：
- 公司官网
- 官方工厂页面
- 官方注册资料
- 官方认证文件

只有集团总部联系方式时，不得伪装成本地法人或工厂联系方式。

不得自行生成 `info@company.com` 等邮箱。

---

## 16. 股权

区分：
- Direct Ownership
- Ultimate Ownership

100% 必须有依据。

合资企业必须保留各方比例。

PLANT_SITE / RND_SITE 不是独立法人时，股权关系属于 ParentLegalEntity；除非模板定义要求，否则不要伪造成 Site 自身股权。

---

## 17. 产品

产品必须是目标法人或目标工厂有可靠来源明确披露的汽车相关产品。

优先工厂级证据。

若仅确认 PCBA：只写可确认层级，如：
- Printed Circuit Board Assemblies (PCBAs)
- Automotive PCBAs（必须有汽车证据）
- Electronic Module Assemblies

不得自行扩展到 ECU / BMS / ADAS Controller / BCM 等，除非来源明确。

原则：能细则细，不能细则停。

中文与英文产品对应，英文优先保留官网原词。

---

## 18. PCBA 专项

如目标属于 PCBA：
1. 找实际生产法人
2. 找 PCBA 生产直接证据
3. 再判断是否有工厂级 Automotive 证据

只有集团服务汽车行业，不足以证明该工厂生产 Automotive PCBA。

---

## 19. 状态

必须检查是否仍运营。

Closed / sold / divested / transferred / discontinued 的地点不得作为当前有效新增生产基地记录直接导入；进入 Review 或按数据库历史记录规则处理。

---

## 20. 数据库名称

如果 supplier_master 已存在同一记录，本 Skill 不应被调用。

若执行过程中发现其实已有记录，立即返回 database-enrichment 重新匹配，不要重复新增。

已有数据库名称必须严格保留大小写、标点、后缀、空格。

---

## 21. 冲突处理

多个来源冲突时：
1. 优先官方
2. 优先更新资料
3. 优先直接监管机构
4. 在 Review 记录冲突及最终选择理由

不得静默选择。

---

## 22. 证据等级

建议内部记录：
- A — 官方法人 / 工厂直接披露
- B — 集团官方披露
- C — 政府 / 监管 / 认证资料
- D — 可靠第三方

只有集团级产品证据不得标记为工厂自产。

---

## 23. 最终 QA

至少检查：
1. 是否为正确具体法人 / Site？
2. 是否误用集团名？
3. 是否把分公司当法人？
4. 地址是否属于目标记录？
5. 地区路径是否正确？
6. 邮编是否匹配？
7. 员工数口径是否正确？
8. 是否把新增就业数当员工数？
9. 资本性质是否区分？
10. CEO 是否属于目标法人？
11. CRN / TIN 是否混淆？
12. 是否错误使用母公司税号？
13. 股权是直接还是穿透？
14. 100% 是否有依据？
15. 是否遗漏合资股东？
16. 产品是否属于目标法人 / 工厂？
17. 是否套用了集团产品？
18. PCBA 是否有直接证据？
19. Automotive 是否有目标级证据？
20. Site 是否已关闭 / 出售？
21. 公司是否更名？
22. 是否发生 parent/group 数据泄漏到 Site 节点？
23. DataType 是否来自真实数据库规则而非猜测？

任一关键项无法确认：宁可留空或 REVIEW_REQUIRED，不得推断。
