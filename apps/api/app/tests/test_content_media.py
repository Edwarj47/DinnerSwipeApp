from __future__ import annotations

import asyncio
import io

import pytest
from PIL import Image

from app.services import content_media as media


def test_photo_source_allowlist() -> None:
    for value in (
        "http://www.nhlbi.nih.gov/a.jpg",
        "https://www.nhlbi.nih.gov.evil.example/a.jpg",
        "https://user:pass@www.nhlbi.nih.gov/a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://upload.wikimedia.org/a.svg",
        "https://upload.wikimedia.org:8443/a.jpg",
    ):
        with pytest.raises(media.ContentPhotoError):
            media.public_photo_url(value)
    assert media.public_photo_url("https://upload.wikimedia.org/a.jpg?tracking=1") == (
        "https://upload.wikimedia.org/a.jpg"
    )


def test_commons_footer_cc0_does_not_grant_image_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def html(url: str, **kwargs: object) -> tuple[str, str]:
        return (
            '<span class="licensetpl_short">CC BY-NC 4.0</span>'
            "<footer>All structured data is CC0 and public domain</footer>"
            '<div class="fullImageLink"><img src="https://upload.wikimedia.org/a.jpg"></div>',
            url,
        )

    monkeypatch.setattr(media, "fetch_public_html", html)
    with pytest.raises(media.ContentPhotoError, match="permission"):
        asyncio.run(media.commons_photo("https://commons.wikimedia.org/wiki/File:Example.jpg"))


def test_verified_photo_resolution_and_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    image = Image.new("RGB", (800, 500), (20, 130, 80))
    stream = io.BytesIO()
    image.save(stream, format="JPEG")

    async def fetch(
        url: str, *, maximum: int, kind: str, **kwargs: object
    ) -> tuple[bytes, str, None]:
        assert maximum > 0 and kind == "image"
        return stream.getvalue(), url, None

    monkeypatch.setattr(media, "fetch_public_bytes", fetch)
    result = asyncio.run(
        media.photo_bytes(
            media.ResolvedPhoto(
                "https://upload.wikimedia.org/a.jpg",
                {"license": "Public domain", "permission_verified": True},
            )
        )
    )
    with Image.open(io.BytesIO(result)) as decoded:
        assert decoded.size == (800, 500)
        assert not decoded.getexif()


def test_unverified_photo_never_downloaded(monkeypatch: pytest.MonkeyPatch) -> None:
    async def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("Unverified source was downloaded")

    monkeypatch.setattr(media, "fetch_public_bytes", forbidden)
    with pytest.raises(media.ContentPhotoError, match="permission"):
        asyncio.run(
            media.photo_bytes(media.ResolvedPhoto("https://upload.wikimedia.org/a.jpg", {}))
        )


@pytest.mark.parametrize("license_name", ["CC BY 4.0", "CC BY-SA 4.0"])
def test_attribution_licenses_preserve_title_creator_notice_and_changes(
    monkeypatch: pytest.MonkeyPatch, license_name: str
) -> None:
    async def html(url: str, **kwargs: object) -> tuple[str, str]:
        return (
            '<h1 id="firstHeading">File:Prepared meal.jpg</h1>'
            f'<span class="licensetpl_short">{license_name}</span>'
            '<span class="licensetpl_attr">Credit photographer and studio.</span>'
            '<table><tr><td id="fileinfotpl_aut">Author</td>'
            '<td>Photographer / Studio</td></tr></table>'
            '<div class="fullImageLink"><img src="https://upload.wikimedia.org/a.jpg"></div>',
            url,
        )

    monkeypatch.setattr(media, "fetch_public_html", html)
    photo = asyncio.run(
        media.commons_photo("https://commons.wikimedia.org/wiki/File:Prepared_meal.jpg")
    )
    assert photo.evidence["title"] == "Prepared meal.jpg"
    assert photo.evidence["creator"] == "Photographer / Studio"
    assert photo.evidence["license"] == license_name
    assert photo.evidence["license_url"] == media.LICENSE_URLS[license_name]
    assert "camera metadata removed" in photo.evidence["credit"]
    assert "Credit photographer and studio." in photo.evidence["credit"]
    assert ("image copy remains available" in photo.evidence["credit"]) == (
        license_name == "CC BY-SA 4.0"
    )


def test_copyright_attribution_is_not_silently_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    async def html(url: str, **kwargs: object) -> tuple[str, str]:
        return (
            '<h1 id="firstHeading">File:Meal.jpg</h1>'
            '<span class="licensetpl_short">CC BY 4.0</span>'
            '<table><tr><td id="fileinfotpl_aut">Author</td><td>'
            + "A"
            * 1001
            + "</td></tr></table>"
            '<div class="fullImageLink"><img src="https://upload.wikimedia.org/a.jpg"></div>',
            url,
        )

    monkeypatch.setattr(media, "fetch_public_html", html)
    with pytest.raises(media.ContentPhotoError, match="attribution"):
        asyncio.run(media.commons_photo("https://commons.wikimedia.org/wiki/File:Meal.jpg"))
