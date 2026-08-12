"""Add cobro_cliente — the customer's payments (C-35).

Revision ID: 0011
Revises: 0010
Create Date: 2024-01-11 00:00:00.000000 UTC

Additive: one new table, one new enum type, three indexes. No backfill,
nothing altered on existing tables.

The type is created exactly once, here, following the procedure D-56 pinned
after C-33 broke it: creating a Postgres enum twice does not fail on the new
table — it fails every migration that runs afterwards, and the symptom shows
up in a file with nothing to do with this one. `sa.Enum(...).create(...,
checkfirst=True)` first, then `postgresql.ENUM(..., create_type=False)` inside
`create_table` — never a bare `sa.Enum` there.

No CHECK constraint here, unlike migration 0010's ck_venta_fiado_tiene_cliente:
`cliente_id` is NOT NULL on this table (RN-CCC-03), so there is no pair of
columns whose combination needs policing — the column being required already
says everything the CHECK on `venta` had to say in two directions.

Three indexes, each for a query that exists (same discipline as 0010):
  - negocio_id                            -> the tenant filter on everything
  - (negocio_id, cliente_id, deleted_at)  -> gathering one customer's live
                                              payments, the read this change
                                              exists for
  - (negocio_id, fecha)                   -> the listing by period, and what
                                              C-37 will aggregate over

CRITICAL invariants preserved: no 'saldo' and no 'estado' column (D-01), no
'venta_id' column (RN-CCC-03) — both derived on demand, never stored.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_METODO_COBRO = ("EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO")


def upgrade() -> None:
    # The type is created once, here. The column below then declares it with
    # create_type=False: a plain sa.Enum inside create_table would try to
    # CREATE TYPE a second time — without checkfirst — and blow up every
    # migration that runs after this one (D-56).
    sa.Enum(*_METODO_COBRO, name="metodocobro").create(op.get_bind(), checkfirst=True)
    metodo_cobro = postgresql.ENUM(*_METODO_COBRO, name="metodocobro", create_type=False)

    op.create_table(
        "cobro_cliente",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("negocio_id", sa.Uuid(), nullable=False),
        sa.Column("cliente_id", sa.Uuid(), nullable=False),
        sa.Column("creado_por_usuario_id", sa.Uuid(), nullable=True),
        sa.Column("monto", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("metodo", metodo_cobro, nullable=False),
        sa.Column("comprobante_url", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["negocio_id"], ["negocio.id"], name="fk_cobro_cliente_negocio"
        ),
        sa.ForeignKeyConstraint(
            ["cliente_id"], ["cliente.id"], name="fk_cobro_cliente_cliente"
        ),
        sa.ForeignKeyConstraint(
            ["creado_por_usuario_id"], ["usuario.id"], name="fk_cobro_cliente_creado_por"
        ),
    )

    op.create_index("ix_cobro_cliente_negocio_id", "cobro_cliente", ["negocio_id"])
    op.create_index(
        "ix_cobro_cliente_negocio_cliente_deleted",
        "cobro_cliente",
        ["negocio_id", "cliente_id", "deleted_at"],
    )
    op.create_index(
        "ix_cobro_cliente_negocio_fecha", "cobro_cliente", ["negocio_id", "fecha"]
    )


def downgrade() -> None:
    op.drop_index("ix_cobro_cliente_negocio_fecha", table_name="cobro_cliente")
    op.drop_index("ix_cobro_cliente_negocio_cliente_deleted", table_name="cobro_cliente")
    op.drop_index("ix_cobro_cliente_negocio_id", table_name="cobro_cliente")
    op.drop_table("cobro_cliente")
    sa.Enum(name="metodocobro").drop(op.get_bind(), checkfirst=True)
