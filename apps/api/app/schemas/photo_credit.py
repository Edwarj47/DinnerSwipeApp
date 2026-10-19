from pydantic import BaseModel, ConfigDict, Field


class PhotoCredit(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=4000)
    source_url: str = Field(min_length=1, max_length=2048)
    license_url: str = Field(min_length=1, max_length=2048)
    license: str = Field(min_length=1, max_length=80)
