"""
exportacion_generadores — render a `DocumentoExportacion` into bytes (C-39).

Design decisions implemented (design.md D3, D5, D6):

- D3: `fpdf2` for PDF, `xlsxwriter` for XLSX — both Python-pure, no system
  binaries, small memory footprint (the VPS is a 1 GB Oracle Free Tier box).
  The XLSX writer runs with `constant_memory` (row-by-row, never retaining
  the sheet) — that is the property that matters at 1 GB, not an
  optimization someone could skip.
- D6: the download filename is built here (`construir_nombre_archivo`),
  normalized (no accents, no spaces) and dated, so downloading the same
  account's statement twice never collides into a browser-appended "(1)".

Neither generator recomputes anything: both only walk the
`DocumentoExportacion` the armador already built (D1 — enforced one layer
up, inherited here by construction: this module never imports
`exportacion_armador`'s inputs, only its output type).
"""

import io
import re
import unicodedata
from decimal import Decimal

import xlsxwriter
from fpdf import FPDF

from app.services.exportacion_armador import DocumentoExportacion

CONTENT_TYPE_PDF = "application/pdf"
CONTENT_TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_HISTORIAL_HEADERS = ["Fecha", "Tipo", "Monto", "Saldo acumulado"]


# ── XLSX ─────────────────────────────────────────────────────────────────────


def generar_xlsx(documento: DocumentoExportacion) -> bytes:
    """
    Tabular dump, no decorative formatting (spec: "está para seguir
    trabajando los números en Excel"). `constant_memory=True` writes each
    row as it is emitted instead of retaining the whole sheet in memory.
    """
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True, "constant_memory": True})
    worksheet = workbook.add_worksheet("Cuenta corriente")

    row = 0
    worksheet.write(row, 0, "Negocio")
    worksheet.write(row, 1, documento.nombre_negocio)
    row += 1
    worksheet.write(row, 0, "Cuenta")
    worksheet.write(row, 1, documento.nombre_cuenta)
    row += 1
    worksheet.write(row, 0, "Fecha de emisión")
    worksheet.write(row, 1, documento.fecha_emision.isoformat())
    row += 1
    worksheet.write(row, 0, "Saldo actual")
    worksheet.write(row, 1, _to_float(documento.saldo))
    row += 1

    if documento.saldo_cierre_rango is not None:
        worksheet.write(row, 0, f"Saldo al {documento.saldo_cierre_rango.fecha.isoformat()}")
        worksheet.write(row, 1, _to_float(documento.saldo_cierre_rango.saldo))
        row += 1

    row += 1  # blank separator row

    if documento.incluye_historial:
        for col, header in enumerate(_HISTORIAL_HEADERS):
            worksheet.write(row, col, header)
        row += 1

        if documento.saldo_anterior is not None:
            worksheet.write(row, 0, documento.desde.isoformat() if documento.desde else "")
            worksheet.write(row, 1, "Saldo anterior")
            worksheet.write(row, 3, _to_float(documento.saldo_anterior))
            row += 1

        for fila in documento.filas:
            worksheet.write(row, 0, fila.fecha.isoformat())
            worksheet.write(row, 1, fila.tipo)
            worksheet.write(row, 2, _to_float(fila.monto))
            worksheet.write(row, 3, _to_float(fila.saldo_acumulado))
            row += 1
    else:
        worksheet.write(row, 0, "Sin historial de movimientos.")

    workbook.close()
    return buffer.getvalue()


# ── PDF ──────────────────────────────────────────────────────────────────────


def generar_pdf(documento: DocumentoExportacion) -> bytes:
    """
    A presentable, one-or-more-page document (spec: "está para que el
    negocio se lo muestre a la persona que le debe").
    """
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Cuenta corriente", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, f"Negocio: {documento.nombre_negocio}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 7, f"Cuenta: {documento.nombre_cuenta}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        7,
        f"Fecha de emisión: {documento.fecha_emision.isoformat()}",
        new_x="LMARGIN",
        new_y="NEXT",
    )

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, f"Saldo actual: {documento.saldo}", new_x="LMARGIN", new_y="NEXT")

    if documento.saldo_cierre_rango is not None:
        pdf.set_font("Helvetica", "", 11)
        pdf.cell(
            0,
            7,
            f"Saldo al {documento.saldo_cierre_rango.fecha.isoformat()}: "
            f"{documento.saldo_cierre_rango.saldo}",
            new_x="LMARGIN",
            new_y="NEXT",
        )

    pdf.ln(4)

    if not documento.incluye_historial:
        pdf.set_font("Helvetica", "I", 10)
        pdf.cell(0, 8, "Sin historial de movimientos.", new_x="LMARGIN", new_y="NEXT")
        return bytes(pdf.output())

    col_widths = (35, 30, 45, 45)

    pdf.set_font("Helvetica", "B", 10)
    for header, width in zip(_HISTORIAL_HEADERS, col_widths):
        pdf.cell(width, 8, header, border=1)
    pdf.ln()

    pdf.set_font("Helvetica", "", 10)

    if documento.saldo_anterior is not None:
        fecha_label = documento.desde.isoformat() if documento.desde else ""
        pdf.cell(col_widths[0], 8, fecha_label, border=1)
        pdf.cell(col_widths[1], 8, "Saldo anterior", border=1)
        pdf.cell(col_widths[2], 8, "", border=1)
        pdf.cell(col_widths[3], 8, str(documento.saldo_anterior), border=1)
        pdf.ln()

    for fila in documento.filas:
        pdf.cell(col_widths[0], 8, fila.fecha.isoformat(), border=1)
        pdf.cell(col_widths[1], 8, fila.tipo, border=1)
        pdf.cell(col_widths[2], 8, str(fila.monto), border=1)
        pdf.cell(col_widths[3], 8, str(fila.saldo_acumulado), border=1)
        pdf.ln()

    if len(documento.filas) == 0:
        pdf.set_font("Helvetica", "I", 10)
        pdf.cell(0, 8, "No hubo movimientos en este período.", new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


# ── Nombre de archivo (D6) ────────────────────────────────────────────────────


def _to_float(monto: Decimal) -> float:
    return float(monto)


def _normalizar_para_archivo(texto: str) -> str:
    """Strip accents/diacritics and collapse everything else into `-`."""
    sin_acentos = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    minusculas = sin_acentos.strip().lower()
    con_guiones = re.sub(r"[^a-z0-9]+", "-", minusculas)
    return re.sub(r"-{2,}", "-", con_guiones).strip("-") or "cuenta"


def construir_nombre_archivo(nombre_cuenta: str, fecha_emision, ext: str) -> str:
    """
    `cuenta-corriente-{nombre}-{YYYY-MM-DD}.{ext}` (D6), normalized so it is
    a valid filename on any filesystem and never collides across downloads
    of the same account on different days.
    """
    slug = _normalizar_para_archivo(nombre_cuenta)
    return f"cuenta-corriente-{slug}-{fecha_emision.isoformat()}.{ext}"


__all__ = [
    "CONTENT_TYPE_PDF",
    "CONTENT_TYPE_XLSX",
    "generar_pdf",
    "generar_xlsx",
    "construir_nombre_archivo",
]
