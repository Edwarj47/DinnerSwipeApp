from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.ingestion.url_fetcher import validate_public_url


def test_blocks_localhost() -> None:
    with pytest.raises(HTTPException):
        validate_public_url("http://localhost:8000/recipe")


def test_blocks_metadata_ip() -> None:
    with pytest.raises(HTTPException):
        validate_public_url("http://169.254.169.254/latest/meta-data")
