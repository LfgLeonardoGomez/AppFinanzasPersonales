"""
C-39, task group 3 — the document armador (design.md D1, D2).

Pure logic over the response `ProveedorService.get_cuenta_corriente` /
`ClienteService.get_cuenta_corriente` already produce. No DB, no I/O, no PDF,
no XLSX — that generation lives in `exportacion_generadores` and is tested
separately (group 4).

D1: `armar_documento` receives the already-computed `saldo` and `historial`
and only formats/filters them — it must never recompute anything.
D2: with a range, the document opens with `saldo_anterior`, READ from the
last historial row before `desde` (never summed).
"""

from datetime import date
from decimal import Decimal

from app.services.exportacion_armador import armar_documento


def _fila(fecha: str, tipo: str, monto: str, saldo_acumulado: str, id_=None):
    import uuid

    return {
        "id": id_ or uuid.uuid4(),
        "tipo": tipo,
        "fecha": date.fromisoformat(fecha),
        "monto": Decimal(monto),
        "saldo_acumulado": Decimal(saldo_acumulado),
        "archivo_url": None,
    }


HISTORIAL = [
    _fila("2026-01-05", "FACTURA", "1000.00", "1000.00"),
    _fila("2026-01-10", "PAGO", "300.00", "700.00"),
    _fila("2026-01-15", "FACTURA", "500.00", "1200.00"),
    _fila("2026-01-20", "PAGO", "200.00", "1000.00"),
]


def _armar(**overrides):
    kwargs = dict(
        saldo=Decimal("1000.00"),
        historial=HISTORIAL,
        nombre_cuenta="Ferretería El Tornillo",
        nombre_negocio="Kiosco Don José",
        fecha_emision=date(2026, 8, 25),
        incluir_historial=False,
    )
    kwargs.update(overrides)
    return armar_documento(**kwargs)


class TestEncabezado:
    def test_encabezado_trae_negocio_cuenta_fecha_y_saldo(self):
        doc = _armar()
        assert doc.nombre_negocio == "Kiosco Don José"
        assert doc.nombre_cuenta == "Ferretería El Tornillo"
        assert doc.fecha_emision == date(2026, 8, 25)
        assert doc.saldo == Decimal("1000.00")


class TestSinHistorial:
    def test_sin_incluir_historial_no_hay_filas(self):
        doc = _armar(incluir_historial=False)
        assert doc.incluye_historial is False
        assert doc.filas == []


class TestConHistorialCompleto:
    def test_todas_las_filas_mismo_orden_y_saldo_acumulado(self):
        doc = _armar(incluir_historial=True)
        assert doc.incluye_historial is True
        assert len(doc.filas) == len(HISTORIAL)
        for fila, esperado in zip(doc.filas, HISTORIAL):
            assert fila.id == esperado["id"]
            assert fila.tipo == esperado["tipo"]
            assert fila.fecha == esperado["fecha"]
            assert fila.monto == esperado["monto"]
            assert fila.saldo_acumulado == esperado["saldo_acumulado"]

    def test_mutacion_alterar_un_monto_en_el_armador_rompe_el_test(self):
        """Verificación por mutación (task 3.3): si el armador alterase un
        monto en el camino, esta comparación estricta fallaría."""
        doc = _armar(incluir_historial=True)
        assert doc.filas[0].monto == Decimal("1000.00")
        assert doc.filas[0].monto != Decimal("999.00")


class TestRangoFiltraFilas:
    def test_rango_incluye_solo_filas_dentro_y_los_bordes(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 1, 10),
            hasta=date(2026, 1, 15),
        )
        fechas = [f.fecha for f in doc.filas]
        assert fechas == [date(2026, 1, 10), date(2026, 1, 15)]

    def test_triangulacion_un_dia_antes_y_un_dia_despues_quedan_fuera(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 1, 11),
            hasta=date(2026, 1, 19),
        )
        fechas = [f.fecha for f in doc.filas]
        assert date(2026, 1, 10) not in fechas
        assert date(2026, 1, 20) not in fechas
        assert fechas == [date(2026, 1, 15)]


class TestSaldoAnterior:
    def test_saldo_anterior_es_el_acumulado_de_la_fila_previa_a_desde(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 1, 15),
            hasta=date(2026, 1, 20),
        )
        # última fila antes de 2026-01-15 es la del 2026-01-10 → 700.00
        assert doc.saldo_anterior == Decimal("700.00")

    def test_mutacion_tomar_fila_i_en_vez_de_i_menos_1_rompe_el_test(self):
        """Verificación por mutación (task 3.5): tomar la fila DENTRO del
        rango (i) en lugar de la anterior (i-1) da 1200.00, no 700.00."""
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 1, 15),
            hasta=date(2026, 1, 20),
        )
        assert doc.saldo_anterior != Decimal("1200.00")
        assert doc.saldo_anterior == Decimal("700.00")

    def test_triangulacion_sin_filas_previas_saldo_anterior_es_cero(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2025, 12, 1),
            hasta=date(2026, 1, 6),
        )
        assert doc.saldo_anterior == Decimal("0")


class TestReconciliacionAritmetica:
    def test_saldo_anterior_mas_movimientos_da_el_acumulado_final(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 1, 15),
            hasta=date(2026, 1, 20),
        )
        signo = {"FACTURA": 1, "PAGO": -1}
        total = doc.saldo_anterior + sum(
            signo[f.tipo] * f.monto for f in doc.filas
        )
        assert total == doc.filas[-1].saldo_acumulado


class TestSaldoEncabezadoNoCambiaConRango:
    def test_saldo_de_cuenta_completa_no_el_del_rango(self):
        doc = _armar(
            saldo=Decimal("1000.00"),
            incluir_historial=True,
            desde=date(2026, 1, 15),
            hasta=date(2026, 1, 20),
        )
        # El saldo del último movimiento del rango (1000.00) coincide acá por
        # casualidad de los datos de prueba — lo que se afirma es que
        # doc.saldo es EXACTAMENTE el parámetro recibido, no un cómputo del
        # rango.
        assert doc.saldo == Decimal("1000.00")

    def test_mutacion_saldo_de_cuenta_distinto_al_del_rango(self):
        doc = _armar(
            saldo=Decimal("54321.00"),
            incluir_historial=True,
            desde=date(2026, 1, 15),
            hasta=date(2026, 1, 20),
        )
        assert doc.saldo == Decimal("54321.00")


class TestDosSaldosCuandoHastaEsPasado:
    def test_expone_saldo_al_cierre_del_rango_y_el_actual(self):
        doc = _armar(
            saldo=Decimal("1000.00"),
            incluir_historial=True,
            desde=date(2026, 1, 10),
            hasta=date(2026, 1, 15),
            fecha_emision=date(2026, 8, 25),
        )
        assert doc.saldo_cierre_rango is not None
        assert doc.saldo_cierre_rango.saldo == Decimal("1200.00")
        assert doc.saldo_cierre_rango.fecha == date(2026, 1, 15)
        assert doc.saldo == Decimal("1000.00")
        assert doc.fecha_emision == date(2026, 8, 25)

    def test_sin_hasta_pasado_no_hay_segundo_saldo(self):
        doc = _armar(incluir_historial=True, desde=date(2026, 1, 10))
        assert doc.saldo_cierre_rango is None


class TestRangoSinMovimientos:
    def test_produce_encabezado_y_cero_filas_sin_error(self):
        doc = _armar(
            incluir_historial=True,
            desde=date(2026, 6, 1),
            hasta=date(2026, 6, 30),
        )
        assert doc.filas == []
        assert doc.saldo_anterior == Decimal("1000.00")  # último acumulado antes del rango
