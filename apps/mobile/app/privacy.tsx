import { LegalPage } from "@/components/LegalPage";
import { privacySections } from "@/features/legal/legalContent";

export default function PrivacyScreen() {
  return (
    <LegalPage
      effectiveDate="August 3, 2026"
      eyebrow="Privacy"
      sections={privacySections}
      title="Privacy Policy"
    />
  );
}
