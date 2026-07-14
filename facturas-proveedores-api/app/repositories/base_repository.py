"""
Generic BaseRepository — data access only (CRUD + soft delete).

Design decisions (D-C02-8, design.md):
- Repositories are PURE DATA ACCESS: SQL and persistence only.
- NO business logic, NO authorization, NO invariant validation here.
- The service layer (C-06, C-08, C-10) enforces business rules.

Generic parameter T must be a SQLModel table model that inherits from
TimestampUUIDMixin. Models with soft delete must also inherit SoftDeleteMixin.
"""

import uuid
from datetime import datetime, timezone
from typing import Generic, TypeVar, Type, Optional

from sqlmodel import Session, select, SQLModel

T = TypeVar("T", bound=SQLModel)


class BaseRepository(Generic[T]):
    """
    Generic repository for CRUD + soft delete over a SQLModel table.

    Instantiate with a concrete model class:
        repo = BaseRepository(session, Proveedor)

    NOTE: soft_delete only works on models that have a 'deleted_at' column.
    Attempting soft_delete on a model without deleted_at raises AttributeError.
    """

    def __init__(self, session: Session, model: Type[T]) -> None:
        self.session = session
        self.model = model

    def get(self, entity_id: uuid.UUID) -> Optional[T]:
        """
        Retrieve entity by primary key.

        Returns None if not found. Does NOT filter by deleted_at
        (caller decides whether deleted entities are relevant).
        """
        return self.session.get(self.model, entity_id)

    def list(self, **filters) -> list[T]:
        """
        List active entities matching the given keyword filters.

        By default filters out soft-deleted entities (deleted_at IS NULL)
        if the model has that column. Additional filters are passed as
        equality conditions (e.g., usuario_id=<uuid>).
        """
        statement = select(self.model)

        # Apply caller-provided equality filters
        for field_name, value in filters.items():
            col = getattr(self.model, field_name, None)
            if col is not None:
                statement = statement.where(col == value)

        # Soft-delete filter: only for models with deleted_at
        if hasattr(self.model, "deleted_at"):
            statement = statement.where(
                getattr(self.model, "deleted_at") == None  # noqa: E711
            )

        return list(self.session.exec(statement).all())

    def create(self, **data) -> T:
        """
        Create and persist a new entity.

        Keyword arguments become the entity's field values.
        Returns the created entity (flushed but not committed —
        caller controls the transaction boundary).
        """
        entity = self.model(**data)
        self.session.add(entity)
        self.session.flush()
        self.session.refresh(entity)
        return entity

    def update(self, entity: T, **data) -> T:
        """
        Update fields on an existing entity.

        Updates are applied in-place. Caller must commit.
        """
        for field_name, value in data.items():
            setattr(entity, field_name, value)
        self.session.add(entity)
        self.session.flush()
        self.session.refresh(entity)
        return entity

    def soft_delete(self, entity_id: uuid.UUID) -> Optional[T]:
        """
        Mark an entity as deleted by setting deleted_at = now().

        Does NOT remove the row from the database (preserves FK integrity).
        Returns the updated entity, or None if not found.

        Raises AttributeError if the model does not support soft delete.
        """
        entity = self.get(entity_id)
        if entity is None:
            return None

        if not hasattr(entity, "deleted_at"):
            raise AttributeError(
                f"Model {self.model.__name__} does not support soft delete "
                f"(no 'deleted_at' column)."
            )

        entity.deleted_at = datetime.now(timezone.utc)  # type: ignore[attr-defined]
        self.session.add(entity)
        self.session.flush()
        return entity


__all__ = ["BaseRepository"]
