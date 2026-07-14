"""Add refresh_token table for opaque session tokens.

Revision ID: 0002
Revises: 0001
Create Date: 2024-01-02 00:00:00.000000 UTC

Design decision D-C03-2:
- Stores only the SHA-256 hash of the opaque refresh token.
- revoked_at=NULL means active; populated means revoked/rotated.
- Does NOT include a 'saldo', 'estado', or 'factura_id' column.
- Indexes: token_hash (lookup), usuario_id (future revoke-all).

Downgrade: drops refresh_token only. C-02 tables (usuario, proveedor,
factura, factura_item, pago) are NOT touched.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── refresh_token ──────────────────────────────────────────────────────────
    op.create_table(
        "refresh_token",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("usuario_id", UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuario.id"],
            name="fk_refresh_token_usuario_id",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_refresh_token_hash"),
    )
    # Index for fast lookup by hash (used on every /refresh call)
    op.create_index(
        "ix_refresh_token_hash",
        "refresh_token",
        ["token_hash"],
        unique=True,
    )
    # Index for future revoke-all-sessions-for-user
    op.create_index(
        "ix_refresh_token_usuario_id",
        "refresh_token",
        ["usuario_id"],
    )


def downgrade() -> None:
    """Remove refresh_token table and its indexes. C-02 tables are NOT touched."""
    op.drop_index("ix_refresh_token_usuario_id", table_name="refresh_token")
    op.drop_index("ix_refresh_token_hash", table_name="refresh_token")
    op.drop_table("refresh_token")
