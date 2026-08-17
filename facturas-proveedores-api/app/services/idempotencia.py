"""
Shared helper for services that trade an IntegrityError for a friendlier
response (C-42).

The trap this module exists to close: `cliente_service.crear` used to catch
a bare `IntegrityError` and assume it was the name-duplicate violation — true
only while `cliente` carried a single unique index. C-43 (design.md D6)
closed that `except` using `es_violacion_de` below, comparing against
`uq_cliente_negocio_nombre_normalizado_activo` by name and re-raising
anything else. Naming the constraint that fired is the only way to tell two
violations apart, so `venta_service`, `pago_service`, `factura_service` and
`cobro_cliente_service` all use this module from the start instead of
repeating the trap.

**Not** what C-43 does to `cliente`: it does NOT add idempotency there.
`cliente` is already deduplicated by its own name index (C-32) — a double
submit correctly answers 409 with the existing customer, which is the right
behavior. C-43 only closes the `except`; the alta itself is untouched.

`err.orig.diag.constraint_name` is a psycopg2-specific diagnostic field,
populated straight from the Postgres error response. Every level is read
defensively: a different driver, a driver upgrade that renames the attribute,
or an IntegrityError raised without a DBAPI error attached should degrade to
`None` rather than raise a second exception on top of the first.
"""

from typing import Optional

from sqlalchemy.exc import IntegrityError


def nombre_constraint_violada(err: IntegrityError) -> Optional[str]:
    """
    The name of the database constraint that raised `err`, or None if it
    cannot be determined.

    Callers compare the result against the specific constraint they expect
    (e.g. `uq_venta_negocio_idempotency_key`) — a mismatch, including None,
    means the violation is not theirs to handle and the original error should
    propagate.
    """
    orig = getattr(err, "orig", None)
    diag = getattr(orig, "diag", None)
    return getattr(diag, "constraint_name", None)


def es_violacion_de(err: IntegrityError, constraint: str) -> bool:
    """
    True when `err` was raised by exactly `constraint` violating.

    Sugar over `nombre_constraint_violada`, added in C-43 (design.md D1) once
    a fourth service needed the same comparison the first three (venta,
    C-42) were already writing by hand: `nombre_constraint_violada(err) !=
    _UQ_...`. Not a new mechanism — it exists so that comparison cannot be
    written inverted by accident in any one of the four call sites, nothing
    more.

    Degrades to False whenever the constraint name cannot be determined
    (delegated to `nombre_constraint_violada`'s own defensive reads) — never
    raises on top of the IntegrityError it is inspecting.
    """
    return nombre_constraint_violada(err) == constraint


__all__ = ["nombre_constraint_violada", "es_violacion_de"]
