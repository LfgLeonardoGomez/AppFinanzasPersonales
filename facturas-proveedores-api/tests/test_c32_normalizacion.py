"""
C-32 — the normalization rule, pinned.

This is the most expensive decision in the change to reverse. The unique index
freezes what "the same client" means, so if this function changes later, rows
written under the old rule keep their stale `nombre_normalizado` and the index
stops guaranteeing what it promises — fixing that needs a full-table recompute
inside a migration.

So the rule gets nailed down here with explicit cases, in both directions:

- What MUST collapse: casing, accents, surrounding and repeated whitespace.
- What MUST NOT collapse: phonetic near-misses and reordered words. Merging two
  genuinely different people is worse than allowing a duplicate — a duplicate
  shows up in the list and gets fixed, a silent merge mixes two customers' debt
  and nobody notices until one of them complains.
"""

import pytest

from app.core.normalizacion import normalizar_nombre


class TestLoQueDebeColapsar:
    """Same person, typed differently."""

    @pytest.mark.parametrize(
        "variante",
        ["Juan Pérez", "juan perez", "JUAN PEREZ", "JuAn PéReZ", "juan pérez"],
    )
    def test_mayusculas_y_acentos_no_distinguen(self, variante):
        assert normalizar_nombre(variante) == normalizar_nombre("Juan Pérez")

    @pytest.mark.parametrize(
        "variante",
        ["  Juan Pérez", "Juan Pérez  ", "  Juan   Pérez  ", "Juan\tPérez"],
    )
    def test_los_espacios_sobrantes_no_distinguen(self, variante):
        assert normalizar_nombre(variante) == normalizar_nombre("Juan Pérez")

    def test_todos_los_acentos_del_castellano(self):
        assert normalizar_nombre("Áéíóú Ñandú") == normalizar_nombre("aeiou Ñandu")

    def test_la_dieresis_tambien(self):
        assert normalizar_nombre("Agüero") == normalizar_nombre("Aguero")


class TestLoQueNoDebeColapsar:
    """Different people. This half is what prevents a silent merge."""

    def test_sin_coincidencia_fonetica(self):
        """Perez y Peres suenan igual y son dos apellidos distintos."""
        assert normalizar_nombre("Juan Perez") != normalizar_nombre("Juan Peres")

    def test_no_se_reordenan_las_palabras(self):
        assert normalizar_nombre("Juan Pérez") != normalizar_nombre("Pérez Juan")

    def test_no_se_descartan_palabras(self):
        assert normalizar_nombre("Juan Pérez") != normalizar_nombre("Juan Pérez Gómez")

    def test_no_se_descartan_particulas(self):
        assert normalizar_nombre("Juan de la Cruz") != normalizar_nombre("Juan Cruz")

    def test_nombres_parciales_son_distintos(self):
        """El caso que la normalización NO puede resolver: lo cubre el autocompletado."""
        assert normalizar_nombre("Juan") != normalizar_nombre("Juan Pérez")

    def test_la_enie_no_se_convierte_en_n(self):
        """Decisión explícita: `ñ` es una letra propia, no una `n` con adorno.

        Colapsarlas fusionaría "Peña" con "Pena", que son apellidos distintos.
        """
        assert normalizar_nombre("Peña") != normalizar_nombre("Pena")


class TestForma:
    def test_el_resultado_es_minusculas_y_sin_extremos(self):
        assert normalizar_nombre("  Juan Pérez  ") == "juan perez"

    def test_es_idempotente(self):
        """Normalizar dos veces no puede dar algo distinto que normalizar una."""
        una = normalizar_nombre("  JUAN   Pérez ")
        assert normalizar_nombre(una) == una

    def test_cadena_vacia_o_solo_espacios(self):
        assert normalizar_nombre("") == ""
        assert normalizar_nombre("    ") == ""

    def test_no_toca_los_digitos(self):
        assert normalizar_nombre("Kiosco 24hs") == "kiosco 24hs"
