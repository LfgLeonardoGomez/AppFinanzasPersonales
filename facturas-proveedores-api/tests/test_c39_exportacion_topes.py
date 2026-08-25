"""
C-39, task group 5 — the row cap (design.md D5, Open Questions).

No scheduler on the VPS to hand the work off to (D-65) — so instead of a
background job, an oversized export fails FAST and EXPLICITLY, with the real
row count and a suggestion to narrow the range, instead of a timeout, a 500,
or (worst of all) a silently truncated document.
"""

import pytest
from fastapi import HTTPException

from app.services.exportacion_topes import TOPE_FILAS, verificar_tope


class TestVerificarTope:
    def test_excede_el_tope_responde_422_con_cantidad_y_sugerencia(self):
        with pytest.raises(HTTPException) as exc_info:
            verificar_tope(cantidad_filas=TOPE_FILAS["pdf"] + 1, formato="pdf")

        assert exc_info.value.status_code == 422
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["cantidad_movimientos"] == TOPE_FILAS["pdf"] + 1
        assert "acot" in detail["sugerencia"].lower()  # "acotar el rango"

    def test_mutacion_tope_bajado_a_1_produce_422_no_documento(self, monkeypatch):
        """Verificación por mutación (task 5.1): con el tope en 1, una
        cuenta con 2 filas tiene que rechazarse."""
        monkeypatch.setitem(TOPE_FILAS, "pdf", 1)
        with pytest.raises(HTTPException) as exc_info:
            verificar_tope(cantidad_filas=2, formato="pdf")
        assert exc_info.value.status_code == 422

    def test_acotar_por_debajo_del_tope_no_levanta_nada(self):
        # No debe lanzar — el valor de retorno es irrelevante.
        verificar_tope(cantidad_filas=TOPE_FILAS["xlsx"] - 1, formato="xlsx")

    def test_topes_de_pdf_y_xlsx_son_distintos(self):
        assert TOPE_FILAS["pdf"] != TOPE_FILAS["xlsx"]
        # El XLSX usa constant_memory: su techo es más alto que el del PDF.
        assert TOPE_FILAS["xlsx"] > TOPE_FILAS["pdf"]
