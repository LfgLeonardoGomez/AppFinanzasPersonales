"""
exportacion_topes — the hard row cap per export format (C-39, design.md D5).

Why a hard cap instead of a background job: the orthodox answer to "a huge
document might tip over a memory-bounded process" is to queue the work and
notify when it's ready. That needs a scheduler, and this VPS does not have
one (D-65 rejected the same class of infrastructure for expiring keys, for
the same reason). So instead: generating a document that would exceed the
cap is rejected FAST, with the real row count and a concrete way out
(narrow the range) — never a timeout, never a 500, and never a silently
truncated file.

The two formats do not cost the same to generate (XLSX runs with
`constant_memory`, PDF does not), so the cap is defined per format, not
once for both.

Open Question in design.md: these starting values are CONSERVATIVE. The
definitive numbers get set by measuring against the real container, not by
guessing — until that measurement exists, this errs low.
"""

from fastapi import HTTPException, status

# Conservative starting point (design.md Open Questions) — raise only after
# measuring actual memory/time against the real 1 GB container, never by
# eyeballing it.
TOPE_FILAS: dict[str, int] = {
    "pdf": 500,
    "xlsx": 5000,
}


def verificar_tope(cantidad_filas: int, formato: str) -> None:
    """
    Raise HTTPException(422) if `cantidad_filas` (the historial rows that
    would actually appear in the document, AFTER date filtering) exceeds the
    cap for `formato`. Must be called before any bytes are generated (D5) —
    the caller decides that ordering; this function only decides pass/fail.
    """
    tope = TOPE_FILAS[formato]
    if cantidad_filas > tope:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "mensaje": (
                    f"La cuenta tiene {cantidad_filas} movimientos, que supera "
                    f"el tope de {tope} para exportar en {formato}. "
                    "Acotá el rango de fechas para reducir la cantidad de "
                    "movimientos e intentá de nuevo."
                ),
                "cantidad_movimientos": cantidad_filas,
                "tope": tope,
                "sugerencia": "Acotá el rango de fechas para bajar la cantidad de movimientos.",
            },
        )


__all__ = ["TOPE_FILAS", "verificar_tope"]
