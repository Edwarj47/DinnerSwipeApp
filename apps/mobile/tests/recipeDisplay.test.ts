import {
  formatCandidateStatus,
  formatDifficulty,
  formatSourceType
} from "@/features/recipes/recipeDisplay";

test("hides internal recipe source and status values from display text", () => {
  expect(formatSourceType("url_structured_data")).toBe("Web recipe");
  expect(formatSourceType("url_html")).toBe("Web recipe");
  expect(formatDifficulty("requires_review")).toBe("Not set");
  expect(formatCandidateStatus("recycled")).toBe("Recycle bin");
});
