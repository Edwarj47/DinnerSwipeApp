"""Bounded, pinned public downloads for independently licensed review photographs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from bs4 import BeautifulSoup
from fastapi import HTTPException
from PIL import Image

from app.core.config import settings
from app.ingestion.url_fetcher import fetch_public_bytes, fetch_public_html
from app.services.private_media import normalize_image

PHOTO_HOSTS = frozenset(
    {"www.nhlbi.nih.gov", "nhlbi.nih.gov", "upload.wikimedia.org", "thumb.wikimedia.org"}
)
LICENSE_URLS = {
    "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "PD-USGov": "https://creativecommons.org/publicdomain/mark/1.0/",
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
}
PERMITTED_LICENSES = frozenset(LICENSE_URLS)


@dataclass(frozen=True)
class ResolvedPhoto:
    url: str
    evidence: dict[str, Any]


class ContentPhotoError(ValueError):
    pass


def public_photo_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in PHOTO_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or not parsed.path.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ):
        raise ContentPhotoError("Photo source is not approved.")
    return urlunsplit(parsed._replace(query="", fragment=""))


async def commons_photo(page_url: str) -> ResolvedPhoto:
    parsed = urlsplit(page_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "commons.wikimedia.org"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or not parsed.path.startswith("/wiki/File:")
        or parsed.query
        or parsed.fragment
    ):
        raise ContentPhotoError("A verified Commons file page is required.")
    html, final_url = await fetch_public_html(
        page_url, allowed_hosts={"commons.wikimedia.org"}, https_only=True
    )
    if urlsplit(final_url).hostname != "commons.wikimedia.org":
        raise ContentPhotoError("Photo permission page changed host.")
    soup = BeautifulSoup(html, "html.parser")
    licenses = {node.get_text(" ", strip=True) for node in soup.select(".licensetpl_short")}
    accepted = [name for name in LICENSE_URLS if name in licenses]
    if not accepted:
        raise ContentPhotoError("Photo reuse permission is not supported.")
    image = soup.select_one(".fullImageLink img")
    value = image.get("src") if image else None
    if not isinstance(value, str):
        raise ContentPhotoError("Photograph is unavailable.")
    value = "https:" + value if value.startswith("//") else value
    author_label = soup.find(id="fileinfotpl_aut")
    author_cell = author_label.find_next_sibling("td") if author_label else None
    creator = author_cell.get_text(" ", strip=True) if author_cell else ""
    if not creator or len(creator) > 1000:
        raise ContentPhotoError("Photo creator attribution is unavailable.")
    heading = soup.select_one("#firstHeading")
    title = heading.get_text(" ", strip=True).removeprefix("File:") if heading else ""
    if accepted[0].startswith("CC BY") and (not title or len(title) > 500):
        raise ContentPhotoError("Photograph title is required for attribution.")
    notices = list(
        dict.fromkeys(
            node.get_text(" ", strip=True)
            for node in soup.select(".licensetpl_attr")
            if node.get_text(" ", strip=True)
        )
    )
    notice = " ".join(notices)
    if len(notice) > 2000:
        raise ContentPhotoError("Photo attribution needs additional review.")
    license_name = accepted[0]
    modifications = "Resized and camera metadata removed for Dinner Swipe."
    credit = f"Photo: {title + ' by ' if title else ''}{creator}. {license_name}. {modifications}"
    if notice:
        credit += " " + notice
    if license_name == "CC BY-SA 4.0":
        credit += " This image copy remains available under CC BY-SA 4.0."
    return ResolvedPhoto(
        url=public_photo_url(value),
        evidence={
            "source_url": page_url,
            "title": title,
            "license": license_name,
            "license_url": LICENSE_URLS[license_name],
            "creator": creator,
            "credit": credit,
            "attribution_notice": notice,
            "modifications": modifications,
            "permission_verified": True,
            "verification": "License template on the individual Commons file page",
        },
    )


async def photo_bytes(photo: ResolvedPhoto) -> bytes:
    import io

    if (
        photo.evidence.get("permission_verified") is not True
        or photo.evidence.get("license") not in PERMITTED_LICENSES
    ):
        raise ContentPhotoError("Photo reuse permission has not been verified.")
    source = public_photo_url(photo.url)
    try:
        data, final_url, _ = await fetch_public_bytes(
            source,
            maximum=settings.max_image_upload_size_bytes,
            kind="image",
            allowed_hosts=PHOTO_HOSTS,
            https_only=True,
        )
        public_photo_url(final_url)
        normalized = normalize_image(data)
        with Image.open(io.BytesIO(normalized)) as image:
            if min(image.size) < 200 or max(image.size) < 400:
                raise ContentPhotoError("Photo resolution is too small.")
            # A smaller derivative bounds campaign storage without retaining camera metadata.
            image.thumbnail((1280, 1280))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=82)
            result = output.getvalue()
        if len(result) > 786_432:
            raise ContentPhotoError("Photo exceeds the campaign image-size limit.")
        return result
    except HTTPException as exc:
        raise ContentPhotoError("Photo could not be safely validated.") from exc
