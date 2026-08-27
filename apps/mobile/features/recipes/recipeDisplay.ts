export function formatSourceType(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "manual":
      return "Added by you";
    case "csv":
    case "xlsx":
      return "Spreadsheet";
    case "url_structured_data":
    case "url_html":
      return "Web recipe";
    case "onenote":
      return "OneNote";
    case "ai_generated":
      return "AI draft";
    case "migrated":
      return "Imported";
    default:
      return prettify(value, "Recipe");
  }
}

export function formatDifficulty(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "easy":
      return "Easy";
    case "medium":
    case "moderate":
      return "Medium";
    case "hard":
      return "Hard";
    case "requires_review":
    case "missing":
    case "rejected":
      return "Not set";
    default:
      return prettify(value, "Not set");
  }
}

export function formatMealType(value: string | null | undefined) {
  return prettify(value, "Dinner");
}

export function formatCandidateStatus(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "requires_review":
      return "Needs review";
    case "approved":
      return "Approved";
    case "recycled":
    case "rejected":
      return "Recycle bin";
    case "blocked":
      return "Blocked";
    default:
      return prettify(value, "Draft");
  }
}

function prettify(value: string | null | undefined, fallback: string) {
  const clean = (value ?? "").replaceAll("_", " ").trim();
  if (!clean) return fallback;
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
