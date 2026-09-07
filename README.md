# Supplier Database Agent

Supplier Database Agent 是一个长期使用的汽车供应商生产基地与研发中心整理工具。日常使用时，用户只需向 Codex 输入一个公司名；项目会按固定规则组织研究、主数据匹配、地区 ID 映射、新增供应商补全、QA 和 Excel 导出。

> 核心边界：公司事实只存放在 `work/<company>/research.json`；程序只存放跨公司共享逻辑。禁止新建 `build_<company>_research.*`、`<company>_matcher.*` 或其他公司专用补丁。

## 日常使用

在 Codex 中打开本项目根目录，然后输入公司名，或使用以下格式：

```text
整理 <Company Name> 的全球生产基地和研发中心，按当前 supplier database agent 工作流生成正式导入文件和 Review。
```

Codex 必须先按 `AGENTS.md` 读取三个 Skill 及必要 references，再将研究结果交给共享流水线。深度研究与数据库后处理是两层职责：导出层不会重新搜索网页，也不会重新判断实体。

## 统一流水线

```text
work/<company>/research.json
  -> normalized.json
  -> region_matches.json
  -> supplier_matches.json
  -> new-supplier enrichment (NeedNewSupplier=YES only)
  -> qa.json
  -> Excel export
```

各阶段的责任是：

1. `research.json`：保存组合研究 Skill 核验过的法人、Site、地址、产品/研发内容、状态和来源。
2. `normalized.json`：产生稳定 `record_id`，标准化记录类型、法人/Site 关系与 `StandardSiteName`。
3. `region_matches.json`：仅使用 `region_master` 的实际层级和归属链映射 canonical 地区 ID，不猜 ID。
4. `supplier_matches.json`：结合名称、地区 ID、主营产品和已审核历史判断实体；已匹配记录严格回写主库原名。
5. `new-supplier enrichment`：只处理 `NeedNewSupplier=YES`，并复用研究阶段的 Site、地址、产品/研发内容和来源，只搜索真正缺失的字段。
6. `qa.json`：记录正式导入决策、阻断原因和 Review 记录。
7. Excel export：使用已识别的真实 Sheet、列顺序、字段类型和模板格式做最终渲染。`REVIEW_REQUIRED` 不进入正式导入表。

流水线支持按阶段运行和单个 `record_id` 局部重跑。`dry-run` 只运行数据判断与 QA，不加载任何 Excel 模板。不要直接手工改写中间阶段结果来绕过前置规则。

共享命令（通常由 Codex 调用）如下：

```powershell
pnpm install
pnpm init:references
pnpm test
pnpm company -- "<Company Name>" --stage all
pnpm company -- "<Company Name>" --stage suppliers --record-id <record_id>
pnpm company -- "<Company Name>" --stage all --dry-run
```

`--stage` 支持 `normalize`、`regions`、`suppliers`、`new-suppliers`、`qa`、`export` 和 `all`。原始研究必须先由组合研究 Skill 写入 `work/<company>/research.json`；命令不会凭公司名自行编造研究事实。

## 本地 reference 数据

`references/` 中的主数据和模板是运行必需的本地文件，但它们包含私有数据，不得提交到 GitHub。当前配置需要以下五类文件：

| 用途 | 标准文件名 | 说明 |
| --- | --- | --- |
| 供应商主库 | `supplier_master.xlsx` 或 `supplier_master.csv` | 以 `config/local.json` 中的实际路径为准；不凭扩展名猜字段 |
| 地区主库 | `region_master.csv` | 必须保留 `id/name/level/parentid/areacode/languagetype/internalprimarykey` 等真实结构 |
| 生产基地导入模板 | `productionbase_import_template.xlsx` | 导出时保留原 Sheet、列顺序和格式 |
| 研发中心导入模板 | `rndcenter_import_template.xlsx` | 导出时保留原 Sheet、列顺序和格式 |
| 新增供应商导入模板 | `new_supplier_import_template.xlsx` | 只接收 QA 通过的新增记录 |

如果有 `supplier_alias` 或 `reviewed_match_history` 数据，应放在 `references/` 并通过本地配置接入。如果有历史成功的 `PLANT_SITE` / `RND_SITE` 新增样例，也放在该目录，用于确认 DataType，不得提交。

如果文件名与默认值不同，再将 `config/local.example.json` 复制为 `config/local.json` 并按本机文件调整路径。`config/local.json` 已被 Git 忽略。共享配置样例不应包含密钥、账号或机器绝对路径。

## 当前已识别模板（2.3.0）

- Supplier master 当前实际为无 Sheet 的 CSV：`id, companyname, MainProduct, LocationCountry, Province, city, area, IsHidden`。程序优先寻找标准 `supplier_master.xlsx`，不存在时安全回退到本机 `supplier_master.csv`。
- Region master：`id, name, code, level, parentid, areacode, location, oldcode, languagetype, internalprimarykey`。多语言行通过 `internalprimarykey` 回到 canonical ID。
- Production Base：Sheet `productionbase`；`Key, CompanyName, ProBaseName, Country, Province, City, MainProduct, LanguageType, 操作状态`。
- R&D Center：Sheet `rdcenterbase`；`Key, CompanyName, RdCenterName, Country, Province, City, RDContent, LanguageType, 操作状态`。
- New Supplier：Sheet `supplierbase`；实际 50 列及 canonical 映射保存在 `config/template-profile.json`。

当前真实新增供应商样例确认 `LEGAL_ENTITY DataType=0`。没有 PLANT_SITE 或 RND_SITE 的成功新增样例，因此这两类保持 `unresolved`，只会进入 Review，不会进入正式新增供应商导入表。

## 实体与地区硬规则

- 名称不同不代表实体不同。匹配必须结合名称、地区归属、主营产品与已审核证据。
- 一旦确认对应主库记录，最终名称必须严格使用 `supplier_master` 原名，包括大小写、符号、空格和标点。
- Additional Site 不得降级匹配 Parent Legal Entity。例如 `Proseat GmbH & Co. KG-Schwarzheide Plant` 不能因主库中有 `Proseat GmbH & Co. KG` 就改用母体名称。
- 通用词加同城不能成为 AAM、Brembo、Schaeffler 等不同公司的身份证据。
- 地区必须通过 `region_master` 的层级、`parentid` 归属链和多语言关联确认。`LanguageType 0/1/8` 的同 Key 多语言记录必须回到同一 canonical 地区 ID。

## 新增供应商与 DataType

只有 `NeedNewSupplier=YES` 时才能调用 `new-supplier-enrichment`。内部记录类型严格分为：

- `LEGAL_ENTITY`
- `PLANT_SITE`
- `RND_SITE`

非独立法人的 `PLANT_SITE` / `RND_SITE` 不得自动继承母公司 CRN、TIN、注册资本、CEO，也不得把集团员工数当成 Site 员工数。

DataType 只能来自真实模板、历史成功样例或明确数据库规则。未找到可靠证据的类型必须保持 `unresolved`；对应新增记录进入 `REVIEW_REQUIRED`，不得猜值或进入正式导入表。

## 缓存与 manifest

- supplier master 和 region master 在单次运行中各加载/建立一次索引。
- 地区索引至少包括 `byId`、`byParent`、`byAreaCode`、`byNormalizedName`。
- 相同国家-省/州-市查询复用查询缓存。
- 缓存依赖文件 hash/mtime；只有对应主数据变化时重建对应缓存。
- `manifest.json` 记录每阶段耗时、缓存命中/重建情况、记录数和 QA 统计，便于定位性能与重跑边界。

## Git 边界

应提交：`AGENTS.md`、`skills/`、`rules/`、`schemas/`、`scripts/`、`tests/`、`config/local.example.json`、说明文档、`CHANGELOG.md`、`VERSION`、`.gitignore`。

不提交：`references/` 中的主数据/模板/历史数据、`output/`、`work/`、`cache/`、`node_modules/`、`config/local.json` 与本机密钥。`.gitignore` 采用扩展名防护 reference 数据，因此 `references/*.csv`、`*.xlsx`、`*.json` 等数据文件均保留在本机，而 `references/README.md` 等说明文档仍可提交。

## 主数据或模板更新

- 替换 supplier master 后，只重建 supplier 索引/缓存，不重新研究公司。
- 替换 region master 后，只重建 region 索引/缓存。
- 替换 Excel 模板后，重新识别 Sheet、列顺序、字段类型和 canonical 映射，并仅更新映射/导出层及相关测试。

任何新规则都应遵循 `AGENTS.md` 的 Rule Update Protocol：修改最小永久规则文件、增加回归测试、更新 `CHANGELOG.md` 并提升 `VERSION`。
