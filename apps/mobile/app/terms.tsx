import { LegalPage } from "@/components/LegalPage";
import { termsSections } from "@/features/legal/legalContent";

export default function TermsScreen() {
  return (
    <LegalPage
      effectiveDate="November 17, 2026"
      eyebrow="Terms"
      sections={termsSections}
      title="Terms of Service"
    />
  );
}
