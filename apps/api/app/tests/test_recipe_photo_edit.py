from io import BytesIO
from pathlib import Path
from typing import Any, cast
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Recipe, User
from app.services.media_storage import LocalMediaStorageAdapter


@pytest.fixture
def recipe(client: TestClient, auth_headers: dict[str, str]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Protein shake",
            "servings": 1,
            "accept_placeholder_photo": True,
            "ingredients": [{"original_text": "1 shake"}],
            "instructions": [{"step_number": 1, "text": "Serve one shake."}],
            "nutrition": {"calories": 160, "protein_g": 30},
        },
    )
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json())


def test_owner_can_add_replace_and_keep_nutrition(
    client: TestClient,
    auth_headers: dict[str, str],
    recipe: dict[str, Any],
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr("app.services.private_media.get_media_storage", lambda: storage)
    path = f"/api/v1/recipes/{recipe['id']}/photo"
    urls = []
    for color in ("red", "green"):
        image = BytesIO()
        Image.new("RGB", (16, 16), color).save(image, "JPEG")
        body = image.getvalue()
        response = client.put(
            path, headers=auth_headers, files={"file": ("photo.jpg", body, "image/jpeg")}
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["image_status"] == "validated"
        assert data["nutrition"]["calories"] == 160 and data["nutrition"]["protein_g"] == 30
        assert "Photo missing; placeholder accepted" not in data["validation_warnings"]
        urls.append(data["photo_url"])
    assert urls[0] != urls[1]
    assert (
        client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers)
        .json()["photo_url"]
        .split("&token=")[0]
        == urls[1].split("&token=")[0]
    )
    row = db_session.get(Recipe, recipe["id"])
    assert row is not None and row.photo_source_url == row.photo_url
    assert (
        row.photo_url
        and "/api/v1/media/objects/" in row.photo_url
        and "token=" not in row.photo_url
    )
    assert len(list(tmp_path.rglob("*.jpg"))) == 2


def test_nonowner_and_invalid_images_do_not_write(
    client: TestClient,
    auth_headers: dict[str, str],
    recipe: dict[str, Any],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = Mock()
    monkeypatch.setattr("app.services.private_media.get_media_storage", lambda: storage)
    path = f"/api/v1/recipes/{recipe['id']}/photo"
    assert (
        client.put(
            path, files={"file": ("x.jpg", b"\xff\xd8\xfffixture", "image/jpeg")}
        ).status_code
        == 401
    )
    for mime, data in (("image/svg+xml", b"<svg/>"), ("image/jpeg", b"not-a-jpeg")):
        assert (
            client.put(path, headers=auth_headers, files={"file": ("x", data, mime)}).status_code
            == 400
        )
    monkeypatch.setattr(settings, "max_image_upload_size_bytes", 4)
    assert (
        client.put(
            path,
            headers=auth_headers,
            files={"file": ("x.jpg", b"\xff\xd8\xfflarge", "image/jpeg")},
        ).status_code
        == 413
    )
    user = db_session.query(User).one()
    other = User(email="other@example.com", password_hash=user.password_hash)
    db_session.add(other)
    db_session.flush()
    row = db_session.get(Recipe, recipe["id"])
    assert row is not None
    row.owner_user_id = other.id
    db_session.commit()
    assert (
        client.put(
            path, headers=auth_headers, files={"file": ("x.jpg", b"\xff\xd8\xff", "image/jpeg")}
        ).status_code
        == 404
    )
    storage.save_recipe_image.assert_not_called()
    assert row.photo_url is None
