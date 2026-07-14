"""Initial domain schema: usuario, proveedor, factura, factura_item, pago.

Revision ID: 0001
Revises: None
Create Date: 2024-01-01 00:00:00.000000 UTC

CRITICAL invariants enforced by this migration (D-01, D-02, D-C02-6):
- NO column 'saldo' anywhere (saldo is derived on-demand by GROUP BY).
- NO column 'estado' anywhere (estado is derived by FIFO in service layer).
- NO column 'factura_id' in 'pago' table (payments link to proveedor only).

Indexes align with anticipated queries (D-C02-7):
- proveedor: (usuario_id, deleted_at) for user-scoped active listing
- factura: (usuario_id, proveedor_id, deleted_at, fecha_emision) for FIFO
- pago: (usuario_id, proveedor_id, deleted_at) for balance aggregate
- factura_item: (factura_id) for joining items
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── usuario ────────────────────────────────────────────────────────────────
    op.create_table(
        "usuario",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("nombre", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("telefono", sa.String(length=30), nullable=True),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("nombre_negocio", sa.String(length=120), nullable=True),
        sa.Column("tema_preferido", sa.String(), nullable=False,
                  server_default="CLARO"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_usuario_email"),
    )
    op.create_index("ix_usuario_email", "usuario", ["email"], unique=True)

    # ── proveedor ──────────────────────────────────────────────────────────────
    op.create_table(
        "proveedor",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usuario_id", UUID(as_uuid=True), nullable=False),
        sa.Column("nombre", sa.String(length=120), nullable=False),
        sa.Column("cuit", sa.String(length=13), nullable=True),
        sa.Column("telefono", sa.String(length=30), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("categoria", sa.String(), nullable=False,
                  server_default="OTRO"),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuario.id"],
                                name="fk_proveedor_usuario_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Indexes for proveedor (D-C02-7)
    op.create_index("ix_proveedor_usuario_id", "proveedor", ["usuario_id"])
    op.create_index("ix_proveedor_usuario_deleted",
                    "proveedor", ["usuario_id", "deleted_at"])

    # ── factura ────────────────────────────────────────────────────────────────
    # CRITICAL: no 'estado' column (D-01, D-C02-6)
    op.create_table(
        "factura",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usuario_id", UUID(as_uuid=True), nullable=False),
        sa.Column("proveedor_id", UUID(as_uuid=True), nullable=False),
        sa.Column("numero", sa.String(length=60), nullable=True),
        sa.Column("fecha_emision", sa.Date(), nullable=False),
        sa.Column("fecha_vencimiento", sa.Date(), nullable=True),
        sa.Column("monto_total", sa.Numeric(precision=12, scale=2),
                  nullable=False),
        sa.Column("archivo_url", sa.String(), nullable=True),
        sa.Column("origen", sa.String(), nullable=False),
        # NOTE: no 'estado' column — derived on-demand (D-01)
        # NOTE: no 'saldo' column — derived on-demand (D-C02-6)
        sa.ForeignKeyConstraint(["usuario_id"], ["usuario.id"],
                                name="fk_factura_usuario_id"),
        sa.ForeignKeyConstraint(["proveedor_id"], ["proveedor.id"],
                                name="fk_factura_proveedor_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Composite FIFO index: supports user-scoped active invoice listing by date
    op.create_index(
        "ix_factura_usuario_proveedor_deleted_emision",
        "factura",
        ["usuario_id", "proveedor_id", "deleted_at", "fecha_emision"],
    )

    # ── factura_item ───────────────────────────────────────────────────────────
    # NOTE: no deleted_at — lifecycle follows Factura (D-C02-2)
    op.create_table(
        "factura_item",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("factura_id", UUID(as_uuid=True), nullable=False),
        sa.Column("descripcion", sa.String(), nullable=False),
        sa.Column("cantidad", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("precio_unitario", sa.Numeric(precision=12, scale=2),
                  nullable=False),
        sa.ForeignKeyConstraint(["factura_id"], ["factura.id"],
                                name="fk_factura_item_factura_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_factura_item_factura_id", "factura_item", ["factura_id"])

    # ── pago ───────────────────────────────────────────────────────────────────
    # CRITICAL: no 'factura_id' column (RN-PAG-01, D-02)
    op.create_table(
        "pago",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usuario_id", UUID(as_uuid=True), nullable=False),
        sa.Column("proveedor_id", UUID(as_uuid=True), nullable=False),
        sa.Column("monto", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("metodo", sa.String(), nullable=False),
        sa.Column("comprobante_url", sa.String(), nullable=True),
        sa.Column("origen", sa.String(), nullable=False),
        # NOTE: no 'factura_id' — payment linked to proveedor only (RN-PAG-01)
        sa.ForeignKeyConstraint(["usuario_id"], ["usuario.id"],
                                name="fk_pago_usuario_id"),
        sa.ForeignKeyConstraint(["proveedor_id"], ["proveedor.id"],
                                name="fk_pago_proveedor_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pago_usuario_proveedor_deleted",
                    "pago", ["usuario_id", "proveedor_id", "deleted_at"])


def downgrade() -> None:
    """Drop all domain tables in reverse dependency order."""
    # Drop indexes first
    op.drop_index("ix_pago_usuario_proveedor_deleted", table_name="pago")
    op.drop_index("ix_factura_item_factura_id", table_name="factura_item")
    op.drop_index("ix_factura_usuario_proveedor_deleted_emision",
                  table_name="factura")
    op.drop_index("ix_proveedor_usuario_deleted", table_name="proveedor")
    op.drop_index("ix_proveedor_usuario_id", table_name="proveedor")
    op.drop_index("ix_usuario_email", table_name="usuario")

    # Drop tables in reverse FK order
    op.drop_table("pago")
    op.drop_table("factura_item")
    op.drop_table("factura")
    op.drop_table("proveedor")
    op.drop_table("usuario")
