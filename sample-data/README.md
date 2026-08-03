# Sample Import Data

`recipe_import_template.csv` contains canonical headers and two rows: one valid URL-photo row and one intentionally missing-photo row for review-flow testing.

Accepted ingredient cells:

- Newline separated: one ingredient per line
- Semicolon separated: `1 lb chicken; 1 tsp salt`
- JSON array of strings
- JSON array of objects with `quantity`, `unit`, `name`, `original_text`, `section`, `preparation_note`, and `is_optional`

Accepted instruction cells:

- Newline separated
- Numbered text
- Semicolon separated
- JSON array of strings
- JSON array of objects with `step_number`, `text`, `section`, and `timer_minutes`

Cells beginning with `=`, `+`, `-`, or `@` are escaped when exported in CSV error reports to reduce spreadsheet formula-injection risk.

