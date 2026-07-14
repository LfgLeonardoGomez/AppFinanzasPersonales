"""
Tests for the base mixin (TimestampUUIDMixin) and soft-delete mixin.

Uses real PostgreSQL via testcontainers (regla dura #9 — never SQLite).

TDD RED phase: these tests require app/models/base.py to exist.
"""

import uuid
import time
import pytest
from datetime import datetime, timezone

from sqlmodel import Session, create_engine, SQLModel, Field
from sqlalchemy import text

from app.models.base import TimestampUUIDMixin, SoftDeleteMixin


# ── Minimal test models (table=True so SQLModel creates real tables) ──────────

class ConcreteEntity(TimestampUUIDMixin, SQLModel, table=True):
    """Minimal entity that inherits only the base mixin."""
    __tablename__ = "test_concrete_entity"

    name: str


class SoftEntity(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """Entity with both base mixin and soft delete."""
    __tablename__ = "test_soft_entity"

    label: str


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def engine(db_url: str):
    """Create a test engine with real Postgres (via testcontainers fixture)."""
    eng = create_engine(db_url, echo=False)
    # Create only test tables
    SQLModel.metadata.create_all(
        eng,
        tables=[
            SQLModel.metadata.tables["test_concrete_entity"],
            SQLModel.metadata.tables["test_soft_entity"],
        ],
    )
    yield eng
    # Drop ONLY this module's throwaway tables. We avoid
    # SQLModel.metadata.drop_all here on purpose: the global metadata also
    # tracks native PG enum types (e.g. temapreferido) owned by other tables
    # (usuario) that live in the shared session-scoped container. drop_all
    # would emit DROP TYPE for those enums and fail with
    # DependentObjectsStillExist. Dropping just our tables with CASCADE keeps
    # teardown isolated and order-independent.
    with eng.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS test_soft_entity CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS test_concrete_entity CASCADE"))
        conn.commit()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


# ── Tests: id UUID ─────────────────────────────────────────────────────────────

def test_id_is_uuid_type_by_default(session: Session):
    """Spec: id is populated with a UUID produced by new_uuid (UUIDv7 when available)."""
    entity = ConcreteEntity(name="alpha")
    assert entity.id is not None
    assert isinstance(entity.id, uuid.UUID)


def test_two_entities_get_different_ids(session: Session):
    """Edge case: every entity gets a unique id."""
    a = ConcreteEntity(name="a")
    b = ConcreteEntity(name="b")
    assert a.id != b.id


# ── Tests: timestamps ──────────────────────────────────────────────────────────

def test_created_at_populated_on_persist(session: Session):
    """Spec: created_at is non-null after persisting."""
    entity = ConcreteEntity(name="ts-test")
    session.add(entity)
    session.commit()
    session.refresh(entity)

    assert entity.created_at is not None


def test_updated_at_populated_on_persist(session: Session):
    """Spec: updated_at is non-null after persisting."""
    entity = ConcreteEntity(name="upd-test")
    session.add(entity)
    session.commit()
    session.refresh(entity)

    assert entity.updated_at is not None


def test_updated_at_changes_on_update(session: Session):
    """Spec: updated_at changes when entity is updated."""
    entity = ConcreteEntity(name="before-update")
    session.add(entity)
    session.commit()
    session.refresh(entity)
    original_updated = entity.updated_at

    # Small sleep to ensure timestamp difference
    time.sleep(0.05)

    entity.name = "after-update"
    session.add(entity)
    session.commit()
    session.refresh(entity)

    assert entity.updated_at is not None
    assert entity.updated_at != original_updated


# ── Tests: mixin has NO derived columns ──────────────────────────────────────

def test_mixin_has_no_saldo_field():
    """Spec: mixin must NOT expose saldo (derived value, never persisted)."""
    assert not hasattr(TimestampUUIDMixin, "saldo")


def test_mixin_has_no_estado_field():
    """Spec: mixin must NOT expose estado (derived value, never persisted)."""
    assert not hasattr(TimestampUUIDMixin, "estado")


# ── Tests: SoftDeleteMixin ────────────────────────────────────────────────────

def test_soft_delete_mixin_deleted_at_is_none_by_default(session: Session):
    """Spec: deleted_at is nullable and defaults to null (active)."""
    entity = SoftEntity(label="active")
    session.add(entity)
    session.commit()
    session.refresh(entity)

    assert entity.deleted_at is None


def test_soft_delete_mixin_deleted_at_can_be_set(session: Session):
    """Spec: deleted_at can hold a timestamp value (marks entity as deleted)."""
    entity = SoftEntity(label="to-delete")
    session.add(entity)
    session.commit()
    session.refresh(entity)

    now = datetime.now(timezone.utc)
    entity.deleted_at = now
    session.add(entity)
    session.commit()
    session.refresh(entity)

    assert entity.deleted_at is not None


def test_base_mixin_has_no_deleted_at():
    """Spec: TimestampUUIDMixin must NOT include deleted_at (soft delete is separate)."""
    # D-C02-2: Usuario and FacturaItem must not have soft-delete from base mixin
    base_fields = TimestampUUIDMixin.model_fields.keys() if hasattr(TimestampUUIDMixin, "model_fields") else dir(TimestampUUIDMixin)
    assert "deleted_at" not in base_fields
