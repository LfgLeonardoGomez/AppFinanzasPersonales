"""Add token_reset — password recovery (C-31).

Revision ID: 0009
Revises: 0008
Create Date: 2024-01-09 00:00:00.000000 UTC

Revision number reserved back in C-32 (D-46) so the two changes running in
parallel would not both claim it.

Additive: one new table, no backfill, nothing altered elsewhere. Third instance
of the hash-only pattern in this schema, after refresh_token (D-17) and
invitacion_empleado (D-31) — only `token_hash` is stored, so a dump of this
table hands nobody a way in.

Unlike the invitation, this token takes over an EXISTING account, which is why
its TTL is an hour rather than 48 (D1). That lives in the service, not here.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "token_reset",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("usuario_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expira_en", sa.DateTime(), nullable=False),
        sa.Column("usado_en", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["usuario_id"], ["usuario.id"], name="fk_token_reset_usuario"
        ),
    )

    # Unique: the lookup key on redemption, and the guarantee that one token
    # cannot exist twice.
    op.create_index(
        "ix_token_reset_token_hash", "token_reset", ["token_hash"], unique=True
    )
    # Supports counting and invalidating a user's pending tokens (D5).
    op.create_index("ix_token_reset_usuario_id", "token_reset", ["usuario_id"])


def downgrade() -> None:
    op.drop_index("ix_token_reset_usuario_id", table_name="token_reset")
    op.drop_index("ix_token_reset_token_hash", table_name="token_reset")
    op.drop_table("token_reset")
