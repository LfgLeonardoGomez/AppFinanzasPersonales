"""
Shared helper for services that trade an IntegrityError for a friendlier
response (C-42).

The trap this module exists to close: `cliente_service.crear` catches a bare
`IntegrityError` and assumes it is the name-duplicate violation — true only
while `cliente` carries a single unique index. The moment a second one is
added (C-43 is expected to add idempotency to `cliente` too), that assumption
breaks silently: an unrelated constraint violation would be misreported as
"duplicate name" instead of propagating as the 500 it actually is. Naming the
constraint that fired is the only way to tell the two apart, so `venta_service`
uses this from the start instead of repeating the trap.

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


__all__ = ["nombre_constraint_violada"]
