"""Add invitacion_empleado — single-use join codes for a negocio (C-29, D-31).

Revision ID: 0007
Revises: 0006
Create Date: 2024-01-07 00:00:00.000000 UTC

A plain additive migration: one new table, no backfill, no column altered on
any existing table. Unlike 0006 there is no data risk here — the downgrade
drops a table that nothing else references.

Only `codigo_hash` is stored (D-17's criterion applied to invitations): a leak
of this table must not hand anyone a usable code. The unique index on it is
also what makes "this code was already used" a lookup rather than a scan.

CRITICAL invariants untouched: no estado/saldo column anywhere, no factura_id
on pago, and `usuario` keeps `desactivado` rather than a deleted_at (D-32).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invitacion_empleado",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("negocio_id", sa.Uuid(), nullable=False),
        sa.Column("codigo_hash", sa.String(length=64), nullable=False),
        sa.Column("creado_por_usuario_id", sa.Uuid(), nullable=False),
        sa.Column("expira_en", sa.DateTime(), nullable=False),
        sa.Column("usado_en", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["negocio_id"], ["negocio.id"], name="fk_invitacion_negocio"),
        sa.ForeignKeyConstraint(
            ["creado_por_usuario_id"], ["usuario.id"], name="fk_invitacion_creador"
        ),
    )

    # Unique: the lookup key on redemption, and the guarantee that one code
    # cannot exist twice.
    op.create_index(
        "ix_invitacion_empleado_codigo_hash",
        "invitacion_empleado",
        ["codigo_hash"],
        unique=True,
    )
    # Scoped listing of a shop's pending invitations.
    op.create_index(
        "ix_invitacion_empleado_negocio_id",
        "invitacion_empleado",
        ["negocio_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_invitacion_empleado_negocio_id", table_name="invitacion_empleado")
    op.drop_index("ix_invitacion_empleado_codigo_hash", table_name="invitacion_empleado")
    op.drop_table("invitacion_empleado")
