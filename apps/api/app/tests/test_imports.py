from __future__ import annotations

import io

from fastapi.testclient import TestClient
from openpyxl import Workbook


def test_csv_import_partial_flow(client: TestClient, auth_headers: dict[str, str]) -> None:
    csv_data = (
        "name,ingredients,instructions,photo\n"
        "Valid soup,1 cup broth; 1 carrot,Cook broth; Serve,https://example.com/soup.jpg\n"
        ",,Cook,javascript:bad\n"
    )
    response = client.post(
        "/api/v1/imports/upload",
        headers=auth_headers,
        files={"file": ("recipes.csv", io.BytesIO(csv_data.encode()), "text/csv")},
    )
    assert response.status_code == 200
    batch_id = response.json()["batch_id"]
    mapping = response.json()["suggested_mapping"]
    validation = client.post(
        f"/api/v1/imports/{batch_id}/mapping",
        headers=auth_headers,
        json={"mapping": mapping, "accept_missing_photo": False},
    )
    assert validation.status_code == 200
    summary = validation.json()
    assert summary["valid"] == 1
    assert summary["invalid"] == 1


def test_xlsx_import_preview(client: TestClient, auth_headers: dict[str, str]) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["title", "ingredient list", "directions", "image url"])
    sheet.append(
        [
            "Valid tacos",
            "1 cup beans; 4 tortillas",
            "Warm beans; Fill tortillas",
            "https://example.com/tacos.jpg",
        ]
    )
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    response = client.post(
        "/api/v1/imports/upload",
        headers=auth_headers,
        files={
            "file": (
                "recipes.xlsx",
                buffer,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200
    mapping = response.json()["suggested_mapping"]
    assert mapping["name"] == "title"
    validation = client.post(
        f"/api/v1/imports/{response.json()['batch_id']}/mapping",
        headers=auth_headers,
        json={"mapping": mapping, "accept_missing_photo": False},
    )
    assert validation.json()["valid"] == 1
