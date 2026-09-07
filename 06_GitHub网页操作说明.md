# GitHub 网页操作说明

## 创建仓库
1. 打开 GitHub 并登录。
2. 页面右上角点击 `+`。
3. 点击 `New repository`。
4. Repository name 输入 `supplier-database-agent`。
5. Visibility 选择 `Private`。
6. 不勾选 Initialize this repository with README / .gitignore / license。
7. 点击 `Create repository`。
8. 复制页面显示的仓库 URL。

## 为什么一定推荐 Private
这个项目包含你自己的行业规则、数据库字段逻辑和业务工作流。即使真实 supplier master 不上传，仓库本身也有业务价值，因此默认使用 Private。

## 以后如何看版本
在 GitHub 仓库主页：
- `Commits`：查看每次规则修改
- `CHANGELOG.md`：看规则版本说明
- `VERSION`：看当前 Agent 版本

## 如果某次更新错了
不要自己删除文件。对 Codex 说：

`刚才的规则更新有问题。请查看 Git 历史，告诉我最近一次变更影响了哪些文件，并将项目恢复到上一个测试通过的提交。恢复前先说明将回退的 commit。`
