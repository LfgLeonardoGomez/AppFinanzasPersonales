"""Move the isolation axis from usuario_id to negocio_id (C-28, D-27).

Revision ID: 0006
Revises: 0005
Create Date: 2024-01-06 00:00:00.000000 UTC

Why one revision and not six (design D5):
    Alembic wraps each revision in its own transaction. Splitting this across
    revisions opens a window where `negocio_id` is NOT NULL on some tables and
    still nullable on others — which is exactly the half-migrated state where
    a query can silently scope by the wrong axis. It goes in whole or not at all.

Order matters:
    1. create `negocio`
    2. one Negocio per existing Usuario (name from nombre_negocio, with fallback)
    3. add every new column as NULLABLE
    4. backfill: usuario → its new negocio; business rows → their owner's negocio;
       creado_por_usuario_id ← the old usuario_id
    5. drop the old usuario_id columns and their indexes
    6. only NOW apply NOT NULL, and rebuild the scoped indexes on the new axis

Applying NOT NULL before the backfill would fail on any non-empty database —
which is every database that matters here.

CRITICAL invariants preserved:
- NO 'estado' / 'saldo' column anywhere (D-01).
- NO 'factura_id' on pago (RN-PAG-01).
- `usuario` gains `desactivado`, NOT `deleted_at` (D-32): access lifecycle, not
  row deletion.

Downgrade: fully reversible. It drops the negocio axis and restores usuario_id,
resolving each row's owner from `creado_por_usuario_id`, falling back to the
oldest user of that negocio. It does NOT delete rows from usuario, proveedor,
factura or pago.

Note on UUID version: migrated negocios use `gen_random_uuid()` (v4) rather than
the app's UUIDv7 (D-16). v7's time-ordering matters for FIFO tie-breaking on
facturas; a negocio id participates in no ordering, so v4 is fine here and
avoids shipping a UUIDv7 implementation into SQL.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


# Indexes that lead with usuario_id and must move to the negocio axis.
# (index name, table)
_OLD_SCOPED_INDEXES = [
    ("ix_proveedor_usuario_id", "proveedor"),
    ("ix_proveedor_usuario_deleted", "proveedor"),
    ("ix_proveedor_usuario_nombre_lower", "proveedor"),
    ("ix_factura_usuario_proveedor_deleted_emision", "factura"),
    ("ix_factura_usuario_deleted_emision", "factura"),
    ("ix_pago_usuario_proveedor_deleted", "pago"),
    ("ix_pago_usuario_proveedor_deleted_fecha", "pago"),
]

_BUSINESS_TABLES = ("proveedor", "factura", "pago")


def upgrade() -> None:
    # ── 1. The tenant table ───────────────────────────────────────────────────
    op.create_table(
        "negocio",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("nombre", sa.String(length=120), nullable=False),
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
    )

    # ── 2. + 3. New columns, all nullable for now ─────────────────────────────
    op.add_column("usuario", sa.Column("negocio_id", sa.Uuid(), nullable=True))
    op.add_column(
        "usuario",
        sa.Column(
            "es_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "usuario",
        sa.Column(
            "desactivado", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )

    for tabla in _BUSINESS_TABLES:
        op.add_column(tabla, sa.Column("negocio_id", sa.Uuid(), nullable=True))
        op.add_column(
            tabla, sa.Column("creado_por_usuario_id", sa.Uuid(), nullable=True)
        )

    # ── 4. Backfill ───────────────────────────────────────────────────────────
    # A temp mapping table keeps the usuario→negocio pairing explicit. Doing it
    # with a bare INSERT..SELECT would create the right number of negocios but
    # lose which one belongs to whom.
    op.execute(
        """
        CREATE TEMP TABLE _negocio_map (
            usuario_id uuid PRIMARY KEY,
            negocio_id uuid NOT NULL
        ) ON COMMIT DROP
        """
    )
    op.execute(
        "INSERT INTO _negocio_map (usuario_id, negocio_id) "
        "SELECT id, gen_random_uuid() FROM usuario"
    )
    op.execute(
        """
        INSERT INTO negocio (id, nombre, created_at, updated_at)
        SELECT m.negocio_id,
               COALESCE(NULLIF(btrim(u.nombre_negocio), ''),
                        'Negocio de ' || u.nombre),
               now(), now()
        FROM _negocio_map m
        JOIN usuario u ON u.id = m.usuario_id
        """
    )
    op.execute(
        "UPDATE usuario u SET negocio_id = m.negocio_id "
        "FROM _negocio_map m WHERE m.usuario_id = u.id"
    )
    # Everyone who existed before this change owns their own shop.
    op.execute("UPDATE usuario SET es_admin = true, desactivado = false")

    for tabla in _BUSINESS_TABLES:
        op.execute(
            f"""
            UPDATE {tabla} t
            SET negocio_id = u.negocio_id,
                creado_por_usuario_id = t.usuario_id
            FROM usuario u
            WHERE u.id = t.usuario_id
            """
        )

    # ── 5. Retire the old axis ────────────────────────────────────────────────
    # Indexes first: dropping the column would take them with it, and alembic's
    # later drop_index would then fail on a missing object.
    for index_name, tabla in _OLD_SCOPED_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {index_name}")

    for tabla in _BUSINESS_TABLES:
        op.drop_column(tabla, "usuario_id")

    # ── 6. Constraints and the rebuilt index set ──────────────────────────────
    op.alter_column("usuario", "negocio_id", nullable=False)
    for tabla in _BUSINESS_TABLES:
        op.alter_column(tabla, "negocio_id", nullable=False)

    op.create_foreign_key(
        "fk_usuario_negocio", "usuario", "negocio", ["negocio_id"], ["id"]
    )
    for tabla in _BUSINESS_TABLES:
        op.create_foreign_key(
            f"fk_{tabla}_negocio", tabla, "negocio", ["negocio_id"], ["id"]
        )
        op.create_foreign_key(
            f"fk_{tabla}_creado_por", tabla, "usuario", ["creado_por_usuario_id"], ["id"]
        )

    op.create_index("ix_usuario_negocio_id", "usuario", ["negocio_id"])

    op.create_index("ix_proveedor_negocio_id", "proveedor", ["negocio_id"])
    op.create_index(
        "ix_proveedor_negocio_deleted", "proveedor", ["negocio_id", "deleted_at"]
    )
    op.execute(
        "CREATE INDEX ix_proveedor_negocio_nombre_lower "
        "ON proveedor (negocio_id, LOWER(nombre))"
    )

    op.create_index("ix_factura_negocio_id", "factura", ["negocio_id"])
    op.create_index(
        "ix_factura_negocio_proveedor_deleted_emision",
        "factura",
        ["negocio_id", "proveedor_id", "deleted_at", "fecha_emision"],
    )
    op.create_index(
        "ix_factura_negocio_deleted_emision",
        "factura",
        ["negocio_id", "deleted_at", "fecha_emision"],
    )

    op.create_index("ix_pago_negocio_id", "pago", ["negocio_id"])
    op.create_index(
        "ix_pago_negocio_proveedor_deleted_fecha",
        "pago",
        ["negocio_id", "proveedor_id", "deleted_at", "fecha"],
    )


def downgrade() -> None:
    # Rebuild the usuario_id axis without losing business rows.
    for index_name in (
        "ix_pago_negocio_proveedor_deleted_fecha",
        "ix_pago_negocio_id",
        "ix_factura_negocio_deleted_emision",
        "ix_factura_negocio_proveedor_deleted_emision",
        "ix_factura_negocio_id",
        "ix_proveedor_negocio_nombre_lower",
        "ix_proveedor_negocio_deleted",
        "ix_proveedor_negocio_id",
        "ix_usuario_negocio_id",
    ):
        op.execute(f"DROP INDEX IF EXISTS {index_name}")

    for tabla in _BUSINESS_TABLES:
        op.drop_constraint(f"fk_{tabla}_creado_por", tabla, type_="foreignkey")
        op.drop_constraint(f"fk_{tabla}_negocio", tabla, type_="foreignkey")
    op.drop_constraint("fk_usuario_negocio", "usuario", type_="foreignkey")

    # Restore usuario_id: prefer the recorded author, fall back to the oldest
    # member of that negocio so no row is left orphaned.
    for tabla in _BUSINESS_TABLES:
        op.add_column(tabla, sa.Column("usuario_id", sa.Uuid(), nullable=True))
        op.execute(
            f"""
            UPDATE {tabla} t
            SET usuario_id = COALESCE(
                t.creado_por_usuario_id,
                (SELECT u.id FROM usuario u
                 WHERE u.negocio_id = t.negocio_id
                 ORDER BY u.created_at ASC, u.id ASC
                 LIMIT 1)
            )
            """
        )
        op.alter_column(tabla, "usuario_id", nullable=False)
        op.create_foreign_key(
            f"fk_{tabla}_usuario", tabla, "usuario", ["usuario_id"], ["id"]
        )

    for tabla in _BUSINESS_TABLES:
        op.drop_column(tabla, "creado_por_usuario_id")
        op.drop_column(tabla, "negocio_id")

    op.drop_column("usuario", "desactivado")
    op.drop_column("usuario", "es_admin")
    op.drop_column("usuario", "negocio_id")

    op.drop_table("negocio")

    # Recreate the pre-0006 scoped indexes.
    op.create_index("ix_proveedor_usuario_id", "proveedor", ["usuario_id"])
    op.create_index(
        "ix_proveedor_usuario_deleted", "proveedor", ["usuario_id", "deleted_at"]
    )
    op.execute(
        "CREATE INDEX ix_proveedor_usuario_nombre_lower "
        "ON proveedor (usuario_id, LOWER(nombre))"
    )
    op.create_index(
        "ix_factura_usuario_proveedor_deleted_emision",
        "factura",
        ["usuario_id", "proveedor_id", "deleted_at", "fecha_emision"],
    )
    op.create_index(
        "ix_factura_usuario_deleted_emision",
        "factura",
        ["usuario_id", "deleted_at", "fecha_emision"],
    )
    op.create_index(
        "ix_pago_usuario_proveedor_deleted",
        "pago",
        ["usuario_id", "proveedor_id", "deleted_at"],
    )
    op.create_index(
        "ix_pago_usuario_proveedor_deleted_fecha",
        "pago",
        ["usuario_id", "proveedor_id", "deleted_at", "fecha"],
    )
