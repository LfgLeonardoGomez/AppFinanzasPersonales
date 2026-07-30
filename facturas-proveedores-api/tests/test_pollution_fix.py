"""
Regression tests for c-17 test pollution fix.

ROOT CAUSE
==========
`tests/test_deps.py::TestLazyEngine::test_deps_module_does_not_construct_engine_at_import`
deletes `app.core.deps` from `sys.modules` and re-imports it. This creates
a NEW `app.core.deps` module with a NEW `get_db` function object.

The app's routers (registered when `app.main` was first loaded) keep
their reference to the OLD `get_db`. The 6 polluting integration test
files' fixtures did `from app.core.deps import get_db` to set
`app.dependency_overrides[get_db] = override_get_db`. After the
`del sys.modules`, this import gets the NEW `get_db`, so the override
is set for the WRONG key. The routes' `Depends(get_db)` (which
references the OLD `get_db`) never finds the override and falls
through to the lazy engine in the OLD `app.core.deps` module — which
is bound to a dead testcontainer DSN (because the alembic migration
test files mutated `os.environ["DATABASE_URL"]` and didn't restore it).

THE FIX
========
The polluting integration test files' fixtures MUST import `get_db`
from a router module (which holds the OLD reference in its namespace)
instead of from `app.core.deps` (which holds the NEW reference after
the reload).

THESE REGRESSION TESTS (white-box, Option B per spec)
====================================================
Each test inspects the SOURCE CODE of the polluting file's fixture and
asserts that the `get_db` import comes from a router module, NOT from
`app.core.deps`. This is fast (no pytest re-execution) and catches the
regression at the source: if a future PR reverts the import to
`app.core.deps`, the test fails.

We use AST inspection rather than string matching to be robust against
formatting changes (imports on multiple lines, comments, etc.).
"""

import ast
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TESTS_DIR = os.path.join(REPO_ROOT, "tests")


def _imported_from(text: str, function_name: str, target_module_prefix: str) -> bool:
    """
    Return True if `text` (a Python file's source) contains a function
    whose body has `from <module> import get_db` where <module> starts
    with `target_module_prefix`.

    Uses AST so multi-line imports, comments, and formatting don't matter.
    """
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            for child in ast.walk(node):
                if isinstance(child, ast.ImportFrom) and child.module and child.module.startswith(target_module_prefix):
                    for alias in child.names:
                        if alias.name == "get_db":
                            return True
    return False


def _imported_get_db_from(text: str, function_name: str) -> str | None:
    """
    Return the module from which `get_db` is imported inside the given
    function, or None if not found.
    """
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            for child in ast.walk(node):
                if isinstance(child, ast.ImportFrom) and child.module:
                    for alias in child.names:
                        if alias.name == "get_db":
                            return child.module
    return None


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


# ── Module-identity invariant ────────────────────────────────────────────────


class TestRouterModuleIdentityInvariant:
    """
    The router modules MUST keep their reference to the OLD `get_db` even
    after `app.core.deps` is deleted from `sys.modules` and re-imported.

    If this invariant is broken (e.g. the routers are also re-imported), the
    fix in the polluting files' fixtures would not work because the routers
    would have a NEW `get_db` too.
    """

    def test_routers_keep_old_get_db_after_deps_reload(self):
        import sys
        import importlib
        from app.main import app  # noqa: F401 — ensure app is loaded

        old_get_db = sys.modules["app.routers.facturas"].get_db

        # Simulate test_deps.py::TestLazyEngine::test_deps_module_does_not_construct_engine_at_import
        for mod_name in list(sys.modules):
            if mod_name.startswith("app.core.deps"):
                del sys.modules[mod_name]
        importlib.import_module("app.core.deps")

        new_get_db_from_deps = sys.modules["app.core.deps"].get_db
        router_get_db_after_reload = sys.modules["app.routers.facturas"].get_db

        assert router_get_db_after_reload is old_get_db, (
            "Router's get_db changed after app.core.deps reload — "
            "the fix's premise no longer holds"
        )
        assert router_get_db_after_reload is not new_get_db_from_deps, (
            "Router's get_db is the NEW one — module identity invariant broken"
        )


# ── Per-polluter fixture contract (white-box) ────────────────────────────────


class TestFacturaIntegrationFixtureContract:
    """
    `tests/test_factura_integration.py::fac_app` must import `get_db`
    from `app.routers.facturas`, NOT from `app.core.deps`.

    Before the fix: `from app.core.deps import get_db` (WRONG — gets the
    NEW get_db after test_deps.py reloads app.core.deps).
    After the fix: `from app.routers.facturas import get_db` (CORRECT —
    the router module's namespace keeps the OLD get_db reference).
    """

    def test_fac_app_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_factura_integration.py")
        text = _read(path)
        module = _imported_get_db_from(text, "fac_app")
        assert module is not None, (
            "test_factura_integration.py::fac_app does not import `get_db` "
            "at all — the fixture does not set up the dependency override"
        )
        assert module.startswith("app.routers."), (
            f"test_factura_integration.py::fac_app imports `get_db` from "
            f"`{module}` — MUST import from a router module (e.g. "
            f"`app.routers.facturas`) to survive the test_deps.py "
            f"`del sys.modules` + re-import. This is the c-17 pollution fix."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_factura_integration.py::fac_app imports `get_db` from "
            f"`{module}` — this is the BUGGY pattern. After test_deps.py "
            f"reloads `app.core.deps`, the import gets the NEW `get_db` "
            f"while the routers use the OLD one, so the override is for "
            f"the wrong key and the routes fall through to the lazy engine "
            f"bound to a dead DSN."
        )


class TestPagoIntegrationFixtureContract:
    """
    `tests/test_pago_integration.py::pago_app` must import `get_db`
    from `app.routers.pagos`, NOT from `app.core.deps`.
    """

    def test_pago_app_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_pago_integration.py")
        text = _read(path)
        module = _imported_get_db_from(text, "pago_app")
        assert module is not None, (
            "test_pago_integration.py::pago_app does not import `get_db`"
        )
        assert module.startswith("app.routers."), (
            f"test_pago_integration.py::pago_app imports `get_db` from "
            f"`{module}` — MUST import from `app.routers.pagos` to survive "
            f"the test_deps.py reload. This is the c-17 pollution fix."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_pago_integration.py::pago_app imports `get_db` from "
            f"`{module}` — this is the BUGGY pattern."
        )


class TestProveedorIntegrationFixtureContract:
    """
    `tests/test_proveedor_integration.py::prov_client` must import `get_db`
    from `app.routers.proveedores`, NOT from `app.core.deps`.
    """

    def test_prov_client_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_proveedor_integration.py")
        text = _read(path)
        module = _imported_get_db_from(text, "prov_client")
        assert module is not None, (
            "test_proveedor_integration.py::prov_client does not import `get_db`"
        )
        assert module.startswith("app.routers."), (
            f"test_proveedor_integration.py::prov_client imports `get_db` from "
            f"`{module}` — MUST import from `app.routers.proveedores` to "
            f"survive the test_deps.py reload. This is the c-17 pollution fix."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_proveedor_integration.py::prov_client imports `get_db` from "
            f"`{module}` — this is the BUGGY pattern."
        )


class TestIaVisionIntegrationFixtureContract:
    """
    `tests/test_ia_vision_integration.py::ia_client` must set up a `get_db`
    override using a router module's import, NOT from `app.core.deps`.

    Note: this fixture originally did NOT override `get_db` at all (it relied
    on the real `get_db` which uses the lazy engine). c-17 fixes this by
    adding the override — the override is required because the lazy engine
    in `app.core.deps` gets bound to a dead DSN after test_deps.py reloads
    the module and calls `_get_engine()` with the mutated env.
    """

    def test_ia_client_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_ia_vision_integration.py")
        text = _read(path)
        module = _imported_get_db_from(text, "ia_client")
        assert module is not None, (
            "test_ia_vision_integration.py::ia_client does not import `get_db` "
            "at all — the fixture MUST set up a get_db override (was the "
            "c-17 fix to add the override that the original c-14 code omitted)"
        )
        assert module.startswith("app.routers."), (
            f"test_ia_vision_integration.py::ia_client imports `get_db` from "
            f"`{module}` — MUST import from a router module to survive the "
            f"test_deps.py reload. This is the c-17 pollution fix."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_ia_vision_integration.py::ia_client imports `get_db` from "
            f"`{module}` — this is the BUGGY pattern."
        )


class TestIaVisionNoPersistenceFixtureContract:
    """
    `tests/test_ia_vision_no_persistence.py::client_with_mocked_sdk` must
    set up a `get_db` override using a router module's import, NOT from
    `app.core.deps`.
    """

    def test_client_with_mocked_sdk_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_ia_vision_no_persistence.py")
        text = _read(path)
        module = _imported_get_db_from(text, "client_with_mocked_sdk")
        assert module is not None, (
            "test_ia_vision_no_persistence.py::client_with_mocked_sdk does "
            "not import `get_db` at all — the fixture MUST set up a get_db "
            "override (was the c-17 fix to add the override that the "
            "original c-14 code omitted)"
        )
        assert module.startswith("app.routers."), (
            f"test_ia_vision_no_persistence.py::client_with_mocked_sdk "
            f"imports `get_db` from `{module}` — MUST import from a router "
            f"module to survive the test_deps.py reload."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_ia_vision_no_persistence.py::client_with_mocked_sdk "
            f"imports `get_db` from `{module}` — this is the BUGGY pattern."
        )


class TestPerfilIntegrationFixtureContract:
    """
    `tests/test_perfil_integration.py::perfil_client` must import `get_db`
    from `app.routers.usuarios`, NOT from `app.core.deps`.
    """

    def test_perfil_client_imports_get_db_from_router(self):
        path = os.path.join(TESTS_DIR, "test_perfil_integration.py")
        text = _read(path)
        module = _imported_get_db_from(text, "perfil_client")
        assert module is not None, (
            "test_perfil_integration.py::perfil_client does not import `get_db`"
        )
        assert module.startswith("app.routers."), (
            f"test_perfil_integration.py::perfil_client imports `get_db` from "
            f"`{module}` — MUST import from `app.routers.usuarios` to survive "
            f"the test_deps.py reload. This is the c-17 pollution fix."
        )
        assert not module.startswith("app.core.deps"), (
            f"test_perfil_integration.py::perfil_client imports `get_db` from "
            f"`{module}` — this is the BUGGY pattern."
        )


# ── Triangulation: integration tests still pass in isolation ─────────────────
#
# After the fix, the polluting files' tests MUST still pass in isolation
# (the fix is targeted — it only changes the `get_db` import source, not
# the test assertions or the fixture behavior).


class TestPollutingFilesStillPassInIsolation:
    """
    Triangulation: the fix changes the `get_db` import source. It must NOT
    change the test behavior. Each polluting file's tests must still pass
    when run alone (no test_deps.py in the prefix).
    """

    @pytest.mark.parametrize(
        "test_path",
        [
            "tests/test_factura_integration.py",
            "tests/test_pago_integration.py",
            "tests/test_proveedor_integration.py",
            "tests/test_ia_vision_integration.py",
            "tests/test_ia_vision_no_persistence.py",
            "tests/test_perfil_integration.py",
        ],
    )
    def test_polluting_file_passes_in_isolation(self, test_path):
        """The polluting file's tests still pass in isolation (no regression)."""
        import subprocess
        import sys

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                test_path,
                "-q",
                "--tb=line",
                "-x",  # stop on first failure
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
        )
        assert result.returncode == 0, (
            f"{test_path} failed in isolation after the c-17 fix:\n"
            f"STDOUT:\n{result.stdout[-2000:]}\n"
            f"STDERR:\n{result.stderr[-1000:]}\n"
            f"The fix must not change test behavior — only the fixture's "
            f"`get_db` import source."
        )
