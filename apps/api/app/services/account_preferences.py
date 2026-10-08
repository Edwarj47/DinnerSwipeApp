from app.models.entities import User

DEFAULT_GROUP_KEY = "default_household_id"
DISPLAY_NAME_KEY = "display_name"


def display_name(user: User) -> str | None:
    value = (user.profile.notification_preferences or {}).get(DISPLAY_NAME_KEY)
    return value.strip()[:100] if isinstance(value, str) and value.strip() else None


def configured_default_group(user: User) -> str | None:
    value = (user.profile.notification_preferences or {}).get(DEFAULT_GROUP_KEY)
    return value if isinstance(value, str) and value else None
