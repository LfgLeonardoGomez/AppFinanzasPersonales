"""
Generic sweep for the c-17 / c-25 dependency-override import contract.

ROOT CAUSE (see openspec/changes/c-25-fix-test-dependency-overrides/design.md)
================================================================================
`tests/test_deps.py::TestLazyEngine` deletes `app.core.deps` from
`sys.modules` and re-imports it, producing a NEW `get_db` function object.
Router modules (`app.routers.*`) loaded earlier keep their OLD reference.
A fixture that does `app.dependency_overrides[get_db] = ...` where `get_db`
was imported from `app.core.deps` silently keys the override on the wrong
object once that reload has happened, so the route's `Depends(get_db)`
(bound to the OLD object) never matches and falls through to the real lazy
engine — which may be bound to a dead testcontainer DSN. Symptom: the file
passes alone, fails in the full suite, and only "works" today by
alphabetical collection luck.

WHY A GENERIC SWEEP (not just more hardcoded per-file tests)
================================================================================
`tests/test_pollution_fix.py` locks the c-17 fix in with hardcoded
`TestXFixtureContract` classes — one per file known to be a polluter at
the time c-17 was written. Three more files were added later
(`test_auth_integration.py`, `test_cloudinary_preset_comprobante.py`,
`test_cuenta_corriente_integration.py`) with the exact same buggy import
and none of them were covered, because the guard only ever watches files
someone remembered to add.

This module replaces "remember to add a test" with a structural AST sweep:
it scans every `tests/test_*.py` file for ANY
`<expr>.dependency_overrides[<dependency_name>] = ...` assignment, finds
the enclosing function, and requires the resolved import for
`<dependency_name>` to come from an `app.routers.*` module. It catches any
future violation — for any overridden dependency, not just `get_db` — with
no per-file maintenance.

`tests/test_deps.py` is the one legitimate exception: it tests
`app.core.deps` itself, including the `sys.modules` reload, so its
fixtures correctly import `get_db` from `app.core.deps`. It is the sole
entry in `EXEMPT_FILES` below.
"""

from __future__ import annotations

import ast
import glob
import os

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(TESTS_DIR)

# Files intentionally exempt from this sweep.
#
# `test_deps.py` tests `app.core.deps` itself, including the
# `del sys.modules["app.core.deps"]` + re-import that is the very
# mechanism this sweep otherwise guards against. Its fixtures legitimately
# import `get_db` (and other deps helpers) from `app.core.deps`.
EXEMPT_FILES = {"test_deps.py"}


# ── AST detection ─────────────────────────────────────────────────────────────


def _match_override_target(target: ast.AST) -> str | None:
    """Return the dependency name if `target` is `<expr>.dependency_overrides[<name>]`.

    Handles `app.dependency_overrides[get_db]`, `self.app.dependency_overrides[x]`,
    etc. — any attribute access ending in `.dependency_overrides` subscripted by
    a bare name.
    """
    if not isinstance(target, ast.Subscript):
        return None
    value = target.value
    if not (isinstance(value, ast.Attribute) and value.attr == "dependency_overrides"):
        return None
    sl = target.slice  # Python 3.9+: no ast.Index wrapper
    if isinstance(sl, ast.Name):
        return sl.id
    return None


def _module_level_imports(tree: ast.Module) -> dict[str, str]:
    """Map imported-name -> source module for every top-level `from X import Y`."""
    imports: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                imports[alias.asname or alias.name] = node.module
    return imports


class _OverrideVisitor(ast.NodeVisitor):
    """Walks a module, tracking the enclosing function for each
    `dependency_overrides[...] = ...` assignment and resolving where the
    subscripted name was imported from (function-local import first, else
    module-level import).
    """

    def __init__(self, module_imports: dict[str, str]) -> None:
        self._module_imports = module_imports
        self._func_stack: list[str] = []
        self._func_imports_stack: list[dict[str, str]] = []
        # (enclosing_function_name, dependency_name, resolved_module_or_None)
        self.findings: list[tuple[str, str, str | None]] = []

    def _enter_func(self, node: ast.AST) -> None:
        self._func_stack.append(getattr(node, "name", "<module>"))
        self._func_imports_stack.append({})
        self.generic_visit(node)
        self._func_stack.pop()
        self._func_imports_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._enter_func(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._enter_func(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        if node.module and self._func_imports_stack:
            for alias in node.names:
                self._func_imports_stack[-1][alias.asname or alias.name] = node.module
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        for target in node.targets:
            dep_name = _match_override_target(target)
            if dep_name is not None:
                resolved = self._resolve(dep_name)
                func_name = self._func_stack[-1] if self._func_stack else "<module>"
                self.findings.append((func_name, dep_name, resolved))
        self.generic_visit(node)

    def _resolve(self, name: str) -> str | None:
        for scope in reversed(self._func_imports_stack):
            if name in scope:
                return scope[name]
        return self._module_imports.get(name)


def _find_violations(source: str) -> list[tuple[str, str, str | None]]:
    """Return every `(function, dependency_name, resolved_module)` where the
    resolved import module does NOT start with `app.routers.` (including
    the case where no import was found at all, i.e. `resolved_module is None`).
    """
    tree = ast.parse(source)
    visitor = _OverrideVisitor(_module_level_imports(tree))
    visitor.visit(tree)
    return [
        (func, dep, mod)
        for func, dep, mod in visitor.findings
        if not (mod and mod.startswith("app.routers."))
    ]


def _iter_swept_files() -> list[str]:
    paths = sorted(glob.glob(os.path.join(TESTS_DIR, "test_*.py")))
    return [p for p in paths if os.path.basename(p) not in EXEMPT_FILES]


# ── The sweep itself ─────────────────────────────────────────────────────────


def test_all_dependency_overrides_import_from_router_modules():
    """c-25: every `dependency_overrides[X] = ...` assignment in tests/
    (except the exempted `test_deps.py`) must import `X` from an
    `app.routers.*` module, not from `app.core.deps`.

    This supersedes the hardcoded per-file allowlist in
    `tests/test_pollution_fix.py`: it does not need a new class added
    every time a new integration test file is created.
    """
    failures: list[str] = []
    for path in _iter_swept_files():
        with open(path, encoding="utf-8") as f:
            source = f.read()
        rel_path = os.path.relpath(path, REPO_ROOT)
        for func_name, dep_name, resolved_module in _find_violations(source):
            failures.append(
                f"{rel_path}::{func_name} sets "
                f"`dependency_overrides[{dep_name}]` but imports `{dep_name}` "
                f"from `{resolved_module}` — MUST import from an "
                f"`app.routers.*` module. After tests/test_deps.py deletes "
                f"and re-imports `app.core.deps`, an import from "
                f"`app.core.deps` gets a NEW object that the router's "
                f"`Depends({dep_name})` (bound to the OLD object) never "
                f"matches, so the request falls through to the real "
                f"(possibly dead) DB engine. See "
                f"openspec/changes/c-25-fix-test-dependency-overrides/design.md."
            )
    assert not failures, "\n".join(failures)


def test_deps_py_is_exempted_from_the_sweep():
    """`test_deps.py` legitimately imports `get_db` from `app.core.deps`
    (it tests that module directly, including the `sys.modules` reload).

    This asserts the exemption is doing real work: the detector, run
    directly against test_deps.py's own source (bypassing the exemption
    filter), DOES find the app.core.deps import — proving the file would
    be flagged if it weren't explicitly exempted, and proving the
    exemption isn't hiding an already-clean file.
    """
    assert "test_deps.py" in EXEMPT_FILES
    path = os.path.join(TESTS_DIR, "test_deps.py")
    with open(path, encoding="utf-8") as f:
        source = f.read()
    violations = _find_violations(source)
    assert violations, (
        "test_deps.py has no app.core.deps-sourced dependency_overrides "
        "assignment — the exemption test no longer exercises anything; "
        "check whether test_deps.py's fixtures changed."
    )


# ── Unit tests on the detector itself (synthetic sources) ──────────────────────
#
# These pin the detector's behavior independent of the current repo state,
# so the sweep's correctness doesn't rely solely on "there happen to be
# violations in the repo right now." Each test is a case that MUST be able
# to fail if the detector regresses.


def test_detector_flags_function_local_core_deps_import():
    source = (
        "def my_fixture():\n"
        "    from app.core.deps import get_db\n"
        "    app.dependency_overrides[get_db] = lambda: None\n"
    )
    assert _find_violations(source) == [("my_fixture", "get_db", "app.core.deps")]


def test_detector_accepts_router_import():
    source = (
        "def my_fixture():\n"
        "    from app.routers.pagos import get_db\n"
        "    app.dependency_overrides[get_db] = lambda: None\n"
    )
    assert _find_violations(source) == []


def test_detector_generalizes_to_non_get_db_dependencies():
    """Explicit proof the sweep is not hardcoded to `get_db`."""
    source = (
        "def my_fixture():\n"
        "    from app.core.deps import get_current_user\n"
        "    app.dependency_overrides[get_current_user] = lambda: None\n"
    )
    assert _find_violations(source) == [
        ("my_fixture", "get_current_user", "app.core.deps")
    ]


def test_detector_resolves_module_level_imports():
    source = (
        "from app.core.deps import get_db\n"
        "\n"
        "\n"
        "def my_fixture():\n"
        "    app.dependency_overrides[get_db] = lambda: None\n"
    )
    assert _find_violations(source) == [("my_fixture", "get_db", "app.core.deps")]


def test_detector_flags_missing_import_as_unresolved():
    """If the dependency name is never imported at all, that's still a
    finding (resolved_module is None), since we cannot prove it comes
    from a router module."""
    source = (
        "def my_fixture():\n"
        "    app.dependency_overrides[get_db] = lambda: None\n"
    )
    findings = _find_violations(source)
    assert findings == [("my_fixture", "get_db", None)]
