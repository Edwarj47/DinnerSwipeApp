import { LegalPage } from "@/components/LegalPage";
import { termsSections } from "@/features/legal/legalContent";

export default function TermsScreen() {
  return (
    <LegalPage
      effectiveDate="October 1, 2026"
      eyebrow="Terms"
      sections={termsSections}
      title="Terms of Service"
    />
  );
}
