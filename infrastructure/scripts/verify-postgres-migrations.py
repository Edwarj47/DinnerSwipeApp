"""Exercise upgrades and rollback only against an explicitly disposable CI database."""

import os
from datetime import datetime

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.models.entities import ComplimentaryPremiumAccess, User, UserSubscription


def main() -> None:
    url = os.environ["CI_MIGRATION_DATABASE_URL"]
    parsed = make_url(url)
    if (parsed.host, parsed.port, parsed.database) != (
        "127.0.0.1",
        15413,
        "migration_test",
    ):
        raise ValueError(
            "Only localhost:15413/migration_test may be migrated by this check"
        )
    os.environ["MIGRATION_DATABASE_URL"] = url
    config = Config("alembic.ini")
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1
    engine = create_engine(url)
    assert not inspect(engine).has_table("users"), (
        "Use an empty disposable migration database"
    )
    baseline = "d9b46e13a702"
    command.upgrade(config, baseline)
    with Session(engine) as db:
        user = User(
            email="migration-fixture@example.com",
            password_hash="synthetic-fixture",
            email_verified=True,
        )
        db.add(user)
        db.flush()
        db.add(
            UserSubscription(
                user_id=user.id,
                source="stripe",
                status="active",
                plan_key="basic_monthly",
                stripe_subscription_id="sub_migration_fixture",
                current_period_end=datetime(2030, 1, 1),
                metadata_json={"trial_used": True},
            )
        )
        db.commit()
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with Session(engine) as db:
        sub = db.scalars(select(UserSubscription)).one()
        assert (
            sub.plan_key == "basic_monthly"
            and sub.stripe_subscription_id == "sub_migration_fixture"
        )
        assert sub.current_period_end == datetime(2030, 1, 1)
        assert db.scalars(select(ComplimentaryPremiumAccess)).first() is None
    command.downgrade(config, baseline)
    assert not inspect(engine).has_table("complimentary_premium_access")
    command.upgrade(config, "head")
    assert inspect(engine).has_table("complimentary_premium_access")
    print(
        "Fresh and populated upgrades, repeat upgrade, no-backfill and disposable rollback passed."
    )


if __name__ == "__main__":
    main()
