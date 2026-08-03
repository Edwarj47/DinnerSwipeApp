# Import Format Specification

Canonical headers:

`name`, `ingredients`, `instructions`, `photo`, `description`, `servings`, `prep_minutes`, `cook_minutes`, `total_minutes`, `difficulty`, `tags`, `cuisine`, `meal_type`, `source_url`, `source_name`

Required canonical fields are `name`, `ingredients`, `instructions`, and `photo`. The UI can intentionally accept a missing photo warning.

Ingredients may be newline-separated, semicolon-separated, JSON array strings, or JSON array objects. Instructions may be newline-separated, numbered text, semicolon-separated, JSON array strings, or JSON array objects.

The parser enforces configured file-size, row-count, and cell-length limits. XLSX uploads must have ZIP signatures and a single worksheet for the MVP. Error-report CSV output escapes cells beginning with `=`, `+`, `-`, or `@`.

Sample files:

- `sample-data/recipe_import_template.csv`
- `sample-data/recipe_import_template.xlsx`
- `sample-data/alternate_headers.csv`
- `sample-data/invalid_rows.csv`

