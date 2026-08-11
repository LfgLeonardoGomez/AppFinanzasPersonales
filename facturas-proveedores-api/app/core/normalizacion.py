"""
Name normalization for customer identity (C-32).

This decides whether two typed names mean the same person. It is deliberately
kept apart from RN-VINC's supplier normalization even though today they do
almost the same thing: that one only *suggests* matches in an autocomplete,
this one *decides identity*. Coupling them would mean that tweaking supplier
search — a UX change with no apparent risk — silently changes which customers
count as the same person, and therefore whose debt is whose.

The rule is conservative on purpose. What it collapses: casing, accents,
surrounding and repeated whitespace. What it refuses to collapse: phonetic
near-misses, reordered words, dropped particles.

Merging two different people is worse than allowing a duplicate. A duplicate is
visible in the list and can be fixed; a silent merge mixes two customers' debt
and surfaces only when one of them argues about the total. The cases the rule
cannot catch ("Juan" vs "Juan Pérez") are covered by showing the user what
already exists before they create anything — the defence is the autocomplete,
not a cleverer algorithm.

Changing this function later is expensive: the unique index on
`(negocio_id, nombre_normalizado)` freezes the current rule into stored data,
so rows written before a change keep their old value and the index stops
guaranteeing uniqueness. It would take a full-table recompute inside a
migration. `tests/test_c32_normalizacion.py` pins the behaviour so an
accidental change breaks the build instead of the data.
"""

import re
import unicodedata

# `ñ` is a letter in its own right, not an `n` with a mark. NFKD would decompose
# it and the accent-stripping pass would turn "Peña" into "Pena" — two different
# surnames merged into one customer. It is swapped out for a private-use
# codepoint across the decomposition and restored afterwards.
_MARCADOR_ENIE = ""

_ESPACIOS = re.compile(r"\s+")


def normalizar_nombre(nombre: str) -> str:
    """
    Return the comparison form of a customer name.

    Steps, in order:
        1. trim the ends
        2. lowercase
        3. protect `ñ`
        4. NFKD decomposition, dropping combining marks (accents, diaeresis)
        5. restore `ñ`
        6. collapse internal whitespace runs to a single space

    Idempotent: normalizing an already-normalized value returns it unchanged.
    """
    texto = nombre.strip().lower()
    if not texto:
        return ""

    texto = texto.replace("ñ", _MARCADOR_ENIE)

    descompuesto = unicodedata.normalize("NFKD", texto)
    sin_marcas = "".join(
        caracter
        for caracter in descompuesto
        if not unicodedata.combining(caracter)
    )

    sin_marcas = sin_marcas.replace(_MARCADOR_ENIE, "ñ")

    return _ESPACIOS.sub(" ", sin_marcas).strip()


__all__ = ["normalizar_nombre"]
