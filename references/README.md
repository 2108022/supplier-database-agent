# Local reference files

This folder stays inside the local Codex project, but the real database files are intentionally ignored by Git.

Place these five files here using EXACTLY these filenames:

1. supplier_master.xlsx
2. region_master.csv
3. productionbase_import_template.xlsx
4. rndcenter_import_template.xlsx
5. new_supplier_import_template.xlsx

Optional but strongly recommended if available:
- a historical successful new-supplier import containing a PLANT_SITE example
- a historical successful new-supplier import containing an RND_SITE example

Do not remove these files from the local folder after pushing the project to GitHub. `.gitignore` only prevents upload; Codex and the local scripts can still read them.
