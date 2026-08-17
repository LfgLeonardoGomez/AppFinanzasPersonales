"""Add idempotency_key to pago, factura and cobro_cliente (C-43 Fase A).

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-16 00:00:00.000000 UTC

Reserved up front per D-46, same discipline as every prior revision (design.md
D5): C-36 runs in parallel and adds no migration, so 0013 is uncontested.

One revision for three tables, on purpose. All three columns exist for the
same reason, deploy in the same window, and revert together — three separate
revisions would be three downtime windows for one atomic change, and would
let the system pass through an intermediate state (pagos protected, cobros
not) that nobody wants reachable.

Additive: three nullable columns, three partial unique indexes that index
ZERO rows when they are created — no backfill, no table rewrite, no existing
row can violate them.

The piece that carries the whole guarantee, once per table:

    CREATE UNIQUE INDEX uq_<tabla>_negocio_idempotency_key
        ON <tabla> (negocio_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL

Deliberately **not** `WHERE idempotency_key IS NOT NULL AND deleted_at IS
NULL`, same reasoning as migration 0012 (venta.idempotency_key, C-42) and
UNLIKE migration 0008's customer-name index. There the predicate exists so a
soft-deleted customer releases their name and can be re-added. Here the
predicate would release a used key the moment its row is deleted — and a late
retry, arriving after the delete, would then create a SECOND row under a key
that was supposed to have already answered that exact question. The key is
consumed by the operation that used it, not by the lifecycle of the row it
produced (design.md D2, D5).

`factura_item` does NOT gain a column. The operation being deduplicated is
"register an invoice with its detail" — one intention, not one per line
(design.md D5, task 2.5).

Round trip: `downgrade` drops the three indexes then the three columns,
cleanly — there is no enum type to leak (D-56 does not apply to plain uuid
columns) and no data to lose that this migration itself wrote, since every
existing row has idempotency_key NULL.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

_TABLES = ["pago", "factura", "cobro_cliente"]
_INDEX_NAME = {
    "pago": "uq_pago_negocio_idempotency_key",
    "factura": "uq_factura_negocio_idempotency_key",
    "cobro_cliente": "uq_cobro_cliente_negocio_idempotency_key",
}


def upgrade() -> None:
    for tabla in _TABLES:
        op.add_column(
            tabla, sa.Column("idempotency_key", sa.Uuid(), nullable=True)
        )

        # Partial: the WHERE clause is the whole point (see module docstring).
        # Deliberately does NOT also exclude deleted_at.
        op.execute(
            f"""
            CREATE UNIQUE INDEX {_INDEX_NAME[tabla]}
                ON {tabla} (negocio_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL
            """
        )


def downgrade() -> None:
    for tabla in _TABLES:
        op.execute(f"DROP INDEX IF EXISTS {_INDEX_NAME[tabla]}")
        op.drop_column(tabla, "idempotency_key")
