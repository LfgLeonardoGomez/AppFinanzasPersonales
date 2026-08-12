"""Add venta — what the shop sold, fiado included (C-33).

Revision ID: 0010
Revises: 0009
Create Date: 2024-01-10 00:00:00.000000 UTC

Additive: one new table, no backfill, nothing altered elsewhere.

The piece that matters is the CHECK:

    CHECK ((forma_pago = 'CUENTA_CORRIENTE') = (cliente_id IS NOT NULL))

`cliente_id` must be nullable, because most sales have no customer — which
means the column type alone cannot stop a fiado from being written without
one. A fiado with no customer is money the shop believes it is owed and cannot
collect from anybody; unlike most bad data it is not recoverable by review,
because there is nobody to ask. So the rule lives in the database, where it
also covers import scripts, manual fixes and whatever route gets added later.

Same reasoning as C-32's partial unique index (D-45): the service checks so it
can give a useful message, the database checks so the rule is actually true.

Three indexes, each for a query that exists:
  - negocio_id                          → the tenant filter on everything
  - (negocio_id, fecha)                 → the listing by period
  - (negocio_id, cliente_id, deleted_at) → C-35 gathering a customer's live
                                           fiados without a scan

CRITICAL invariants preserved: no 'saldo' and no 'estado' column (D-01) — both
are derived on demand, here as everywhere else.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_FORMA_PAGO = ("EFECTIVO", "TRANSFERENCIA", "TARJETA", "CUENTA_CORRIENTE", "OTRO")


def upgrade() -> None:
    # The type is created once, here. The column below then declares it with
    # create_type=False: a plain sa.Enum inside create_table would try to
    # CREATE TYPE a second time — without checkfirst — and blow up the whole
    # migration chain with "type formapago already exists".
    sa.Enum(*_FORMA_PAGO, name="formapago").create(op.get_bind(), checkfirst=True)
    forma_pago = postgresql.ENUM(*_FORMA_PAGO, name="formapago", create_type=False)

    op.create_table(
        "venta",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("negocio_id", sa.Uuid(), nullable=False),
        sa.Column("creado_por_usuario_id", sa.Uuid(), nullable=True),
        sa.Column("cliente_id", sa.Uuid(), nullable=True),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("monto", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("forma_pago", forma_pago, nullable=False),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["negocio_id"], ["negocio.id"], name="fk_venta_negocio"),
        sa.ForeignKeyConstraint(["cliente_id"], ["cliente.id"], name="fk_venta_cliente"),
        sa.ForeignKeyConstraint(
            ["creado_por_usuario_id"], ["usuario.id"], name="fk_venta_creado_por"
        ),
        # The invariant, in both directions, in one expression.
        sa.CheckConstraint(
            "(forma_pago = 'CUENTA_CORRIENTE') = (cliente_id IS NOT NULL)",
            name="ck_venta_fiado_tiene_cliente",
        ),
    )

    op.create_index("ix_venta_negocio_id", "venta", ["negocio_id"])
    op.create_index("ix_venta_negocio_fecha", "venta", ["negocio_id", "fecha"])
    op.create_index(
        "ix_venta_negocio_cliente_deleted",
        "venta",
        ["negocio_id", "cliente_id", "deleted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_venta_negocio_cliente_deleted", table_name="venta")
    op.drop_index("ix_venta_negocio_fecha", table_name="venta")
    op.drop_index("ix_venta_negocio_id", table_name="venta")
    op.drop_table("venta")
    sa.Enum(name="formapago").drop(op.get_bind(), checkfirst=True)
