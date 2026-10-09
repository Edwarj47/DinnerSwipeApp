from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast
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

    def read(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

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
        directories = [self.root]
        uploads = self.root / "uploads"
        if uploads.exists():
            directories.append(uploads)
            directories.extend(path for path in uploads.iterdir() if path.is_dir())
        if any(not os.access(path, os.R_OK | os.W_OK | os.X_OK) for path in directories):
            raise RuntimeError(
                "Media volume ownership must be prepared for the runtime UID before deployment"
            )

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()) or not key.startswith("uploads/"):
            raise ValueError("Invalid media key")
        return path

    def read(self, key: str) -> bytes:
        with self._path(key).open("rb") as source:
            return source.read(settings.max_image_upload_size_bytes + 1)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def save_recipe_image(
        self, *, user_id: str, data: bytes, suffix: str, content_type: str
    ) -> StoredMedia:
        del content_type
        key = f"uploads/{user_id}/{uuid4().hex}{suffix}"
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o600)
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
        if (
            self._service()
            .get_container_client(self.container)
            .get_container_properties()
            .get("public_access")
        ):
            raise RuntimeError("Recipe media requires a private Azure container")

    def _service(self) -> Any:
        from azure.storage.blob import BlobServiceClient

        return BlobServiceClient.from_connection_string(self.connection_string)

    def read(self, key: str) -> bytes:
        blob = self._service().get_blob_client(container=self.container, blob=key)
        stream = blob.download_blob()
        if stream.size > settings.max_image_upload_size_bytes:
            raise ValueError("Image is too large")
        return cast(bytes, stream.readall())

    def delete(self, key: str) -> None:
        self._service().get_blob_client(container=self.container, blob=key).delete_blob()

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
