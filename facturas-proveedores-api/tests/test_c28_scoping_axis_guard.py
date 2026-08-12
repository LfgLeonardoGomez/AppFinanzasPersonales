"""
C-28 — structural guard: one isolation axis, and only one.

The measured risk of this change was never "the swap is hard". It was that a
single forgotten `usuario_id` filter survives in a service or repository, passes
every functional test, and quietly serves one shop's data to another.

So this walks the AST of the service and repository layers and fails if the old
axis reappears as a scoping filter. Same technique the project already uses for
the C-17 fixture contract (D-22): a rule the suite enforces, not a rule someone
has to remember during review.

Whitelist (design D8) — `usuario_id` is CORRECT here because it means identity,
not tenancy:
  - usuario_service / usuario_repository — auth and profile
  - refresh_token_repository            — session lifecycle
  - security / rate_limit_ia            — token subject, per-user IA quota
"""

import ast
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1] / "app"

# Modules allowed to mention usuario_id, and why (D8).
_WHITELIST = {
    "usuario_service.py",
    "usuario_repository.py",
    "refresh_token_repository.py",
    # C-31: a reset token belongs to a PERSON, not a shop. `token_reset` has no
    # negocio_id at all — recovering a password is about identity, and the same
    # account could not plausibly be scoped by negocio without breaking the
    # feature. Structurally identical to refresh_token_repository above.
    #
    # Note this is the opposite call from C-29's equipo_service, and the
    # difference is the point: there, `usuario_id` was AMBIGUOUS — the target
    # member inside a negocio-scoped operation — so it got renamed to
    # `miembro_id` rather than excused. Here the name matches the table's own
    # FK column and there is no tenancy dimension to confuse it with; renaming
    # would make the code disagree with the schema.
    "token_reset_repository.py",
    "security.py",
    "rate_limit_ia.py",
    "deps.py",
}

_SCANNED_DIRS = ("services", "repositories")


def _scanned_files():
    for carpeta in _SCANNED_DIRS:
        for path in sorted((APP_ROOT / carpeta).glob("*.py")):
            if path.name == "__init__.py" or path.name in _WHITELIST:
                continue
            yield path


def _identifiers(path: Path) -> set[str]:
    """Every attribute name, arg name and keyword used in the module."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    nombres: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            nombres.add(node.attr)
        elif isinstance(node, ast.Name):
            nombres.add(node.id)
        elif isinstance(node, ast.arg):
            nombres.add(node.arg)
        elif isinstance(node, ast.keyword) and node.arg:
            nombres.add(node.arg)
    return nombres


class TestSingleIsolationAxis:
    def test_scan_actually_covers_the_business_layer(self):
        """A guard that silently scans nothing is worse than no guard."""
        archivos = list(_scanned_files())
        assert len(archivos) >= 6, f"el scan solo encontró {len(archivos)} módulos"

    @pytest.mark.parametrize("path", list(_scanned_files()), ids=lambda p: p.name)
    def test_no_usuario_id_as_scoping_filter(self, path: Path):
        assert "usuario_id" not in _identifiers(path), (
            f"{path.name} still uses `usuario_id`. Business resources scope by "
            f"`negocio_id` (D-27). If this is authorship, the field is "
            f"`creado_por_usuario_id`; if it is genuinely identity, add the "
            f"module to the D8 whitelist in this test with a reason."
        )

    @pytest.mark.parametrize("path", list(_scanned_files()), ids=lambda p: p.name)
    def test_authorship_is_never_a_filter(self, path: Path):
        """D4: creado_por_usuario_id records who loaded a row, nothing more.

        Using it in a WHERE clause would rebuild per-user isolation inside the
        shop — the exact thing this change removes.
        """
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            lados = [node.left, *node.comparators]
            for lado in lados:
                if isinstance(lado, ast.Attribute) and lado.attr == "creado_por_usuario_id":
                    pytest.fail(
                        f"{path.name}: `creado_por_usuario_id` aparece en una "
                        f"comparación. Es autoría, no autorización (D4)."
                    )

    def test_business_models_expose_the_new_axis(self):
        """The model layer is the contract the rest of this guard relies on."""
        from app.models.factura import Factura
        from app.models.pago import Pago
        from app.models.proveedor import Proveedor

        for model in (Proveedor, Factura, Pago):
            assert "negocio_id" in model.model_fields
            assert "usuario_id" not in model.model_fields
