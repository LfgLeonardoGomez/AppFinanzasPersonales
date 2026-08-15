"""Add venta.idempotency_key — a retry-safety marker, not a ledger fact (C-42).

Revision ID: 0012
Revises: 0011
Create Date: 2024-01-12 00:00:00.000000 UTC

Reserved up front per D-46, same discipline as every prior revision: the
number is claimed here before any code exists, so a change proposed later
(C-36..C-41) that also needs a migration takes 0013, never a renumber at
merge time.

Additive: one nullable column, one partial unique index. No backfill — every
row that exists today has no key, which is exactly what NULL means once the
header is optional (D1).

The piece that carries the change's whole guarantee:

    CREATE UNIQUE INDEX uq_venta_negocio_idempotency_key
        ON venta (negocio_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL

Deliberately **not** `WHERE idempotency_key IS NOT NULL AND deleted_at IS
NULL`, unlike migration 0008's customer-name index. There the predicate exists
so a soft-deleted customer releases their name and can be re-added. Here the
predicate would release a used key the moment its sale is deleted — and a late
retry, arriving after the delete, would then create a SECOND sale under a key
that was supposed to have already answered that exact question. The key is
consumed by the operation that used it, not by the lifecycle of the row it
produced (design.md D2).

Round trip: `downgrade` drops the index then the column, cleanly — there is no
enum type to leak (D-56 does not apply to a plain uuid column) and no data to
lose that this migration itself wrote, since every existing row has
idempotency_key NULL.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("venta", sa.Column("idempotency_key", sa.Uuid(), nullable=True))

    # Partial: the WHERE clause is the whole point (see module docstring). It
    # deliberately does NOT also exclude deleted_at — see the docstring above.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_venta_negocio_idempotency_key
            ON venta (negocio_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_venta_negocio_idempotency_key")
    op.drop_column("venta", "idempotency_key")
