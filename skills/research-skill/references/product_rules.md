# Product Rules

## Scope
Production-base product fields must describe products actually manufactured at the specific site when evidence exists.

## Output
Provide both:
- SimplifiedProduct
- DetailedProduct

## SimplifiedProduct
Use a concise, database-friendly product description without brands, series, platform names, commercial model names, or unnecessary marketing terms.

## DetailedProduct
Preserve the finest product granularity explicitly supported by reliable sources.

## Rules
1. Do not infer site products from group-wide product portfolios unless the source ties them to the site/legal entity.
2. Do not use broad placeholders such as “automotive parts” when more specific products are available.
3. Do not treat processes as products: machining, molding, stamping, assembly, testing, coating, R&D, etc. are not products by themselves.
4. Do not treat services, aftermarket service operations, tools, fixtures, production equipment, or applications as products.
5. Remove brands, trademarks, series, model numbers, platforms, and commercial names while preserving the functional product.
6. Materials suppliers: keep only explicitly supplied material products; do not reverse-infer downstream components.
7. If official material reaches only a broad category, stop at that level rather than inventing a deeper hierarchy.
8. If site-specific product evidence is unavailable, leave product fields blank or mark as insufficient evidence rather than guessing.
9. Produce Chinese and English product text when supported/needed by the downstream workflow.
10. Exclude products belonging to unrelated business sectors when the task is automotive-only.
