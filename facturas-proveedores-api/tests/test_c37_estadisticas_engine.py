"""
Tests for the shared bucketing/gap-fill engine
`app/services/estadisticas_engine.py` (C-37, design.md D1/D2/D4).

Pure functions, no DB access. Tasks 2.1-2.6 (bucketing) and 3.1-3.5 (fill).
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models.enums import Granularidad


# ── 2.1 — enumerar_periodos covers the full range, per granularidad ─────────


class TestEnumerarPeriodosCubreElRango:
    def test_dia_devuelve_un_periodo_por_dia(self):
        from app.services.estadisticas_engine import enumerar_periodos

        periodos = enumerar_periodos(date(2026, 3, 1), date(2026, 3, 3), Granularidad.DIA)

        assert [p.inicio for p in periodos] == [
            date(2026, 3, 1),
            date(2026, 3, 2),
            date(2026, 3, 3),
        ]
        # Each daily period starts and ends the same day.
        assert all(p.inicio == p.fin for p in periodos)

    def test_semana_devuelve_un_periodo_por_semana(self):
        from app.services.estadisticas_engine import enumerar_periodos

        # 2026-03-02 is a Monday; 2026-03-16 is the Monday two weeks later.
        periodos = enumerar_periodos(date(2026, 3, 2), date(2026, 3, 16), Granularidad.SEMANA)

        assert [p.inicio for p in periodos] == [
            date(2026, 3, 2),
            date(2026, 3, 9),
            date(2026, 3, 16),
        ]
        assert [p.fin for p in periodos] == [
            date(2026, 3, 8),
            date(2026, 3, 15),
            date(2026, 3, 22),
        ]

    def test_mes_devuelve_un_periodo_por_mes(self):
        from app.services.estadisticas_engine import enumerar_periodos

        periodos = enumerar_periodos(date(2026, 1, 1), date(2026, 3, 31), Granularidad.MES)

        assert [p.inicio for p in periodos] == [
            date(2026, 1, 1),
            date(2026, 2, 1),
            date(2026, 3, 1),
        ]
        assert [p.fin for p in periodos] == [
            date(2026, 1, 31),
            date(2026, 2, 28),
            date(2026, 3, 31),
        ]


# ── 2.2 — a range starting mid-period includes that whole period ────────────


class TestRangoAMitadDePeriodo:
    def test_mes_que_arranca_el_15_sigue_siendo_el_mes_entero(self):
        from app.services.estadisticas_engine import enumerar_periodos

        periodos = enumerar_periodos(date(2026, 2, 15), date(2026, 2, 20), Granularidad.MES)

        assert len(periodos) == 1
        assert periodos[0].inicio == date(2026, 2, 1)
        assert periodos[0].fin == date(2026, 2, 28)

    def test_semana_que_arranca_un_jueves_sigue_siendo_la_semana_entera(self):
        from app.services.estadisticas_engine import enumerar_periodos

        # 2026-03-05 is a Thursday; its week started Monday 2026-03-02.
        periodos = enumerar_periodos(date(2026, 3, 5), date(2026, 3, 6), Granularidad.SEMANA)

        assert len(periodos) == 1
        assert periodos[0].inicio == date(2026, 3, 2)
        assert periodos[0].fin == date(2026, 3, 8)


# ── 2.3 — the week starts Monday (D4), verifiable by mutation ───────────────


class TestSemanaEmpiezaElLunes:
    def test_inicio_de_semana_es_lunes(self):
        from app.services.estadisticas_engine import enumerar_periodos

        # 2026-03-04 is a Wednesday.
        periodos = enumerar_periodos(date(2026, 3, 4), date(2026, 3, 4), Granularidad.SEMANA)

        assert len(periodos) == 1
        assert periodos[0].inicio.weekday() == 0  # Monday
        assert periodos[0].inicio == date(2026, 3, 2)

    def test_mutacion_a_domingo_correria_el_inicio_un_dia(self):
        """
        Verificación por mutación: si `_inicio_semana` restara
        `(weekday()+1) % 7` (arranque domingo) en vez de `weekday()`
        (arranque lunes), el inicio esperado sería 2026-03-01, no
        2026-03-02. Este test fija el valor lunes explícitamente, así que
        esa mutación lo haría fallar.
        """
        from app.services.estadisticas_engine import enumerar_periodos

        periodos = enumerar_periodos(date(2026, 3, 4), date(2026, 3, 4), Granularidad.SEMANA)
        assert periodos[0].inicio != date(2026, 3, 1)  # domingo — NO debe ser esto
        assert periodos[0].inicio == date(2026, 3, 2)  # lunes — debe ser esto


# ── 2.4 — a single-day range yields exactly one period, all granularities ───


class TestRangoDeUnSoloDia:
    @pytest.mark.parametrize(
        "granularidad", [Granularidad.DIA, Granularidad.SEMANA, Granularidad.MES]
    )
    def test_un_solo_dia_da_exactamente_un_periodo(self, granularidad):
        from app.services.estadisticas_engine import enumerar_periodos

        periodos = enumerar_periodos(date(2026, 5, 10), date(2026, 5, 10), granularidad)
        assert len(periodos) == 1


# ── 2.5 — an inverted range is rejected, never an empty list ────────────────


class TestRangoInvertido:
    def test_desde_posterior_a_hasta_se_rechaza(self):
        from app.services.estadisticas_engine import RangoInvertido, enumerar_periodos

        with pytest.raises(RangoInvertido):
            enumerar_periodos(date(2026, 5, 10), date(2026, 5, 1), Granularidad.DIA)

    def test_no_devuelve_lista_vacia_en_silencio(self):
        """La excepción, no un `[]`, es la señal de rango inválido."""
        from app.services.estadisticas_engine import RangoInvertido, enumerar_periodos

        try:
            enumerar_periodos(date(2026, 5, 10), date(2026, 5, 1), Granularidad.MES)
        except RangoInvertido:
            pass
        else:
            pytest.fail("se esperaba RangoInvertido, no un retorno silencioso")


# ── 3.1 — rellenar_periodos zero-fills the gaps ──────────────────────────────


class TestRellenoDeHuecos:
    def test_relleno_completa_periodos_ausentes_con_cero(self):
        from app.services.estadisticas_engine import enumerar_periodos, rellenar_periodos

        periodos = enumerar_periodos(date(2026, 3, 1), date(2026, 3, 3), Granularidad.DIA)
        # Solo el día del medio trae datos.
        totales = {date(2026, 3, 2): Decimal("150.00")}

        serie = rellenar_periodos(periodos, totales)

        assert [row["total"] for row in serie] == [
            Decimal("0.00"),
            Decimal("150.00"),
            Decimal("0.00"),
        ]

    # ── 3.2 — triangulation: gaps at both ends ───────────────────────────────

    def test_hueco_al_principio_y_al_final_tambien_se_rellenan(self):
        from app.services.estadisticas_engine import enumerar_periodos, rellenar_periodos

        periodos = enumerar_periodos(date(2026, 4, 1), date(2026, 4, 4), Granularidad.DIA)
        # Solo hay datos en el segundo y tercer día; primero y último vacíos.
        totales = {
            date(2026, 4, 2): Decimal("10.00"),
            date(2026, 4, 3): Decimal("20.00"),
        }

        serie = rellenar_periodos(periodos, totales)

        assert serie[0]["total"] == Decimal("0.00")
        assert serie[-1]["total"] == Decimal("0.00")
        assert serie[1]["total"] == Decimal("10.00")
        assert serie[2]["total"] == Decimal("20.00")

    # ── 3.3 — an entire range with no data produces all-zero periods ────────

    def test_rango_entero_sin_datos_no_es_lista_vacia(self):
        from app.services.estadisticas_engine import enumerar_periodos, rellenar_periodos

        periodos = enumerar_periodos(date(2026, 6, 1), date(2026, 6, 3), Granularidad.DIA)
        serie = rellenar_periodos(periodos, {})

        assert len(serie) == 3
        assert all(row["total"] == Decimal("0.00") for row in serie)

    # ── 3.4 — chronological order regardless of DB row order ────────────────

    def test_orden_cronologico_independiente_del_orden_de_entrada(self):
        from app.services.estadisticas_engine import enumerar_periodos, rellenar_periodos

        periodos = enumerar_periodos(date(2026, 7, 1), date(2026, 7, 3), Granularidad.DIA)
        # dict insertion order deliberately reversed / out of order.
        totales = {
            date(2026, 7, 3): Decimal("3.00"),
            date(2026, 7, 1): Decimal("1.00"),
        }

        serie = rellenar_periodos(periodos, totales)

        assert [row["periodo"] for row in serie] == [
            date(2026, 7, 1),
            date(2026, 7, 2),
            date(2026, 7, 3),
        ]


# ── contar_periodos: O(1) count used by the tope check (D5), tasks 6.x ──────


class TestContarPeriodos:
    def test_coincide_con_la_longitud_de_enumerar_periodos(self):
        from app.services.estadisticas_engine import contar_periodos, enumerar_periodos

        desde, hasta = date(2026, 1, 1), date(2026, 12, 31)
        for granularidad in (Granularidad.DIA, Granularidad.SEMANA, Granularidad.MES):
            assert contar_periodos(desde, hasta, granularidad) == len(
                enumerar_periodos(desde, hasta, granularidad)
            )

    def test_tambien_rechaza_rango_invertido(self):
        from app.services.estadisticas_engine import RangoInvertido, contar_periodos

        with pytest.raises(RangoInvertido):
            contar_periodos(date(2026, 5, 10), date(2026, 5, 1), Granularidad.MES)
