from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestActor:
    user_id: str
    premium: bool
    nutrition_consent: bool


current_actor: ContextVar[RequestActor | None] = ContextVar("dinner_request_actor", default=None)


@contextmanager
def acting_as(actor: RequestActor) -> Iterator[None]:
    token = current_actor.set(actor)
    try:
        yield
    finally:
        current_actor.reset(token)
