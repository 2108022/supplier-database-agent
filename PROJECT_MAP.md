# Project Map

本仓库是长期维护的 Supplier Database Agent。默认业务输入只有公司名；研究事实写入运行目录，跨公司能力写入共享模块。

| 路径 | 责任 | Git 策略 |
| --- | --- | --- |
| `AGENTS.md` | 总调度、阶段边界与不可违反规则 | 提交 |
| `skills/research-skill/` | 生产基地与研发中心联合研究及证据规则 | 提交 |
| `skills/database-enrichment/` | 标准化、地区映射、供应商匹配、LanguageType、QA、导出编排 | 提交 |
| `skills/new-supplier-enrichment/` | 仅为 `NeedNewSupplier=YES` 的记录补齐缺失基础信息 | 提交 |
| `rules/` | 用户规则入口与永久规则说明 | 提交 |
| `schemas/` | 真实 reference/template 识别结果、canonical 字段映射与数据契约 | 提交（不得含真实主数据） |
| `scripts/` | 跨公司共享实现；禁止公司专用 matcher/build 脚本 | 提交 |
| `tests/` | 回归测试与非敏感 fixture | 提交 |
| `config/local.example.json` | 可提交的本地配置样例 | 提交 |
| `config/local.json` | 本机路径与配置覆盖 | 不提交 |
| `references/` | 真实 supplier/region master、Excel 模板、alias、review history、历史成功样例 | 数据文件不提交；说明文档可提交 |
| `work/<company>/` | `research.json` 到 `qa.json`、`manifest.json` 的阶段产物 | 不提交 |
| `cache/` | 按主数据 hash/mtime 失效的索引与查询缓存 | 不提交 |
| `output/` | 通过 QA 后的正式 Excel 与 Review | 不提交 |

## Shared pipeline

```text
research.json
  -> normalized.json
  -> region_matches.json
  -> supplier_matches.json
  -> new-supplier enrichment (NeedNewSupplier=YES only)
  -> qa.json
  -> Excel export
```

导出层只渲染已完成判断的结构化结果，不进行研究、地区猜测或实体重判。阶段运行、单 `record_id` 重跑、缓存行为和正式导入门禁见根目录 `README.md`。

## Shared implementation

- `scripts/run-company.js`：阶段编排、dry-run、单记录重跑入口。
- `scripts/init-references.js`：只读识别 reference、独立构建 Supplier/Region 缓存并接入审核历史。
- `scripts/check-ready.js`：初始化完整性与开始首家公司前的门禁检查。
- `scripts/lib/region-index.js` / `region-resolver.js`：多语言 canonical ID、父子链和查询缓存。
- `scripts/lib/supplier-index.js` / `supplier-matcher.js`：名称、地区、产品、alias/review history 联合实体判断以及 Site-to-parent 硬阻断。
- `scripts/lib/new-supplier.js` / `qa-gate.js`：NEW-only 交接、DataType 和 parent-data-leakage 门禁。
- `scripts/lib/excel-exporter.js`：只消费 `qa.json` 的最终模板渲染器。
- `config/template-profile.json`：本机真实模板识别出的 Sheet、列顺序、类型、canonical 映射和 DataType 证据状态。
