from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel


class NativeVerificationIn(ApiModel):
    provider: Literal["apple", "google"]
    reference: str = Field(min_length=1, max_length=4096, pattern=r"^[A-Za-z0-9._~+:/=-]+$")


class AppleNotificationIn(ApiModel):
    signedPayload: str = Field(min_length=20, max_length=65536)
