"""Add composite FIFO pool index on pago for C-10 service queries.

Revision ID: 0005
Revises: 0004
Create Date: 2024-01-05 00:00:00.000000 UTC

Purpose (C-10, D11):
    The pago table (created in migration 0001) already has a 3-column index
    (usuario_id, proveedor_id, deleted_at) supporting the per-supplier FIFO
    query that the C-08 `FacturaService.listar` pool consumer uses.

    Migration 0005 extends that index to a 4-column composite
    (usuario_id, proveedor_id, deleted_at, fecha) that covers the same
    query ORDER BY fecha in a single index scan — eliminating an explicit
    sort step as the data set grows.

    Column order rationale (leftmost prefix matching, RN-FIFO-01):
    - usuario_id:    tenant scoping (equality)
    - proveedor_id:  per-supplier scoping (equality)
    - deleted_at:    active-only filter (IS NULL)
    - fecha:         FIFO ordering (ASC for the C-08 pool query)

CRITICAL invariants preserved (D-01, D-C02-6, RN-PAG-01):
- NO 'estado' column added to pago (computed on-demand by FIFO).
- NO 'saldo' column added to pago (computed on-demand, RN-SALDO).
- NO 'factura_id' column added to pago (RN-PAG-01 — payments are
  supplier-scoped, never invoice-scoped).
- Only an index is created — no table or column mutations.

Downgrade: drops the index only. No data loss.
"""

from alembic import op

# revision identifiers
revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Composite FIFO pool index for the C-08 / C-10 payment pool query.
    # Covers: usuario_id equality + proveedor_id equality + deleted_at IS NULL
    # + fecha ordering — a single index scan, no separate sort.
    op.create_index(
        "ix_pago_usuario_proveedor_deleted_fecha",
        "pago",
        ["usuario_id", "proveedor_id", "deleted_at", "fecha"],
    )


def downgrade() -> None:
    # Drop the FIFO pool index. No data loss — pago rows untouched.
    op.drop_index(
        "ix_pago_usuario_proveedor_deleted_fecha",
        table_name="pago",
    )
