from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from app.core.config import settings


@dataclass(frozen=True)
class StoredMedia:
    key: str
    url: str
    backend: str


class MediaStorageAdapter(Protocol):
    backend: str

    def ensure_ready(self) -> None: ...

    def save_recipe_image(
        self, *, user_id: str, data: bytes, suffix: str, content_type: str
    ) -> StoredMedia: ...


class LocalMediaStorageAdapter:
    backend = "local"

    def __init__(self, root: Path, public_api_url: str) -> None:
        self.root = root
        self.public_api_url = public_api_url.rstrip("/")

    def ensure_ready(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def save_recipe_image(
        self, *, user_id: str, data: bytes, suffix: str, content_type: str
    ) -> StoredMedia:
        del content_type
        key = f"uploads/{user_id}/{uuid4().hex}{suffix}"
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return StoredMedia(key=key, url=f"{self.public_api_url}/media/{key}", backend=self.backend)


class AzureBlobMediaStorageAdapter:
    backend = "azure_blob"

    def __init__(self, connection_string: str, container: str, public_base_url: str) -> None:
        self.connection_string = connection_string
        self.container = container
        self.public_base_url = public_base_url.rstrip("/")

    def ensure_ready(self) -> None:
        if not self.connection_string or not self.container or not self.public_base_url:
            raise RuntimeError(
                "Azure media storage requires AZURE_STORAGE_CONNECTION_STRING, "
                "AZURE_STORAGE_CONTAINER, and MEDIA_PUBLIC_BASE_URL"
            )

    def save_recipe_image(
        self, *, user_id: str, data: bytes, suffix: str, content_type: str
    ) -> StoredMedia:
        self.ensure_ready()
        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings
        except ImportError as exc:
            raise RuntimeError(
                "Install azure-storage-blob before enabling MEDIA_STORAGE_BACKEND=azure_blob"
            ) from exc
        key = f"uploads/{user_id}/{uuid4().hex}{suffix}"
        blob_service = BlobServiceClient.from_connection_string(self.connection_string)
        blob_client = blob_service.get_blob_client(container=self.container, blob=key)
        blob_client.upload_blob(
            data,
            overwrite=False,
            content_settings=ContentSettings(content_type=content_type),
        )
        return StoredMedia(key=key, url=f"{self.public_base_url}/{key}", backend=self.backend)


def get_media_storage() -> MediaStorageAdapter:
    if settings.media_storage_backend == "azure_blob":
        return AzureBlobMediaStorageAdapter(
            settings.azure_storage_connection_string,
            settings.azure_storage_container,
            settings.media_public_base_url,
        )
    return LocalMediaStorageAdapter(Path(settings.image_storage_path), settings.public_api_url)
