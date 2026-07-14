"""Add cross-supplier listing index on factura for C-08 service queries.

Revision ID: 0004
Revises: 0003
Create Date: 2024-01-04 00:00:00.000000 UTC

Purpose (C-08, D9):
    The FIFO composite index (usuario_id, proveedor_id, deleted_at, fecha_emision)
    was added in migration 0001 to cover the single-supplier FIFO query.

    Migration 0004 adds a supplementary index (usuario_id, deleted_at, fecha_emision)
    that optimizes the cross-supplier listing query used in
    FacturaService.listar(usuario_id, proveedor_id=None). This query fetches ALL
    active invoices for a user across all suppliers ordered by fecha_emision, to
    then group them by proveedor_id in Python for FIFO computation.

    Column order:
    - usuario_id: tenant scoping (equality)
    - deleted_at: active-only filter (IS NULL)
    - fecha_emision: natural ordering for display purposes

CRITICAL invariants preserved (D-01, D-C02-6):
- NO 'estado' column added to factura.
- NO 'saldo' column added to factura.
- Only an index is created — no table or column mutations.

Downgrade: drops the index only. No data loss.
"""

from alembic import op

# revision identifiers
revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Supplementary index for cross-supplier listing (FacturaService.listar with
    # proveedor_id=None). Covers usuario_id equality + deleted_at IS NULL filter +
    # fecha_emision ordering in a single index scan.
    op.create_index(
        "ix_factura_usuario_deleted_emision",
        "factura",
        ["usuario_id", "deleted_at", "fecha_emision"],
    )


def downgrade() -> None:
    # Drop the cross-supplier listing index. No data loss.
    op.drop_index(
        "ix_factura_usuario_deleted_emision",
        table_name="factura",
    )
