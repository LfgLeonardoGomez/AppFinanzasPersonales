"""Add cliente — the other side of the ledger (C-32).

Revision ID: 0008
Revises: 0007
Create Date: 2024-01-08 00:00:00.000000 UTC

Revision number reserved up front so it would not collide with C-31, which
takes 0009. Two changes each adding a table would otherwise both pick 0008 and
one would have to be renumbered at merge time.

Additive: one new table, no backfill, nothing altered elsewhere.

The piece worth reading twice is the unique index. It is PARTIAL:

    UNIQUE (negocio_id, nombre_normalizado) WHERE deleted_at IS NULL

The predicate is what lets soft delete and uniqueness coexist. A plain unique
index would let a deleted customer hold its own name hostage forever — the shop
could never re-add someone it had removed, and the error would say nothing
about why. Postgres supports partial indexes natively, so this costs nothing.

Uniqueness is per negocio: two different shops may each have their own
"Juan Pérez", and they are not the same person.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cliente",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("negocio_id", sa.Uuid(), nullable=False),
        sa.Column("creado_por_usuario_id", sa.Uuid(), nullable=True),
        sa.Column("nombre", sa.String(length=120), nullable=False),
        sa.Column("nombre_normalizado", sa.String(length=120), nullable=False),
        sa.Column("telefono", sa.String(length=30), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["negocio_id"], ["negocio.id"], name="fk_cliente_negocio"),
        sa.ForeignKeyConstraint(
            ["creado_por_usuario_id"], ["usuario.id"], name="fk_cliente_creado_por"
        ),
    )

    op.create_index("ix_cliente_negocio_id", "cliente", ["negocio_id"])

    # Supports the autocomplete lookup (exact normalized match, then contains).
    op.create_index(
        "ix_cliente_negocio_nombre_norm",
        "cliente",
        ["negocio_id", "nombre_normalizado"],
    )

    # The rule itself. Partial so that a soft-deleted customer releases its name.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_cliente_negocio_nombre_normalizado_activo
            ON cliente (negocio_id, nombre_normalizado)
            WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_cliente_negocio_nombre_normalizado_activo")
    op.drop_index("ix_cliente_negocio_nombre_norm", table_name="cliente")
    op.drop_index("ix_cliente_negocio_id", table_name="cliente")
    op.drop_table("cliente")
