from __future__ import annotations

from app.services.url_ingestion import _user_facing_warnings


def test_url_ingestion_hides_internal_warning_details() -> None:
    warnings = _user_facing_warnings(
        [
            "step 2 contains a range (2-4 minutes), no single integer timer_minutes is provided",
            "Missing photo",
            "Missing timing information",
            "AI normalization failed; deterministic extraction was retained",
        ]
    )

    assert warnings == [
        "Add a photo link or approve a placeholder.",
        "Automatic cleanup had trouble with this page. Review the recipe before approving.",
    ]
