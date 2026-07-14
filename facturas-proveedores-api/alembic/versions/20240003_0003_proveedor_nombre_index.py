"""Add composite expression index (usuario_id, lower(nombre)) on proveedor.

Revision ID: 0003
Revises: 0002
Create Date: 2024-01-03 00:00:00.000000 UTC

Purpose (C-06, D4):
    Supports case-insensitive name search (search_by_nombre) and name ordering
    (order_by='nombre') for the supplier listing. Uses LOWER(nombre) so the
    index is usable by func.lower(Proveedor.nombre) queries without a Postgres
    extension.

Design decision D4 (design.md):
    Expression index on (usuario_id, lower(nombre)) chosen over a collation
    (COLLATE "C"/ICU) for portability and testcontainers compatibility.

CRITICAL invariants preserved:
- NO 'saldo' or 'estado' column added.
- Only an index is created — no table or column mutations.

Downgrade: drops the index only. No data loss.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Composite expression index for case-insensitive name search + ordering (D4).
    # Leading column 'usuario_id' scopes by tenant; 'lower(nombre)' serves both
    # LIKE-based search and ORDER BY func.lower(nombre) queries.
    op.create_index(
        "ix_proveedor_usuario_nombre_lower",
        "proveedor",
        ["usuario_id", sa.text("lower(nombre)")],
    )


def downgrade() -> None:
    # Drop the index only — no table or column is affected.
    op.drop_index("ix_proveedor_usuario_nombre_lower", table_name="proveedor")
