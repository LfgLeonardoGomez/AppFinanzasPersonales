"""
C-39, task 2.2 — smoke test for the two export dependencies (design.md D3).

Not a business test: if the image does not bring `fpdf2`/`xlsxwriter`, every
other C-39 test fails for a reason that has nothing to do with them. This
isolates the environment concern from the business concern.
"""

import io


def test_fpdf2_generates_a_minimal_valid_pdf():
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 10, "smoke test")
    output = bytes(pdf.output())

    assert output.startswith(b"%PDF-")
    assert len(output) > 0


def test_xlsxwriter_generates_a_minimal_valid_workbook():
    import xlsxwriter

    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True})
    worksheet = workbook.add_worksheet()
    worksheet.write(0, 0, "smoke test")
    workbook.close()

    content = buffer.getvalue()
    # XLSX is a ZIP container — starts with the local file header signature.
    assert content.startswith(b"PK")
    assert len(content) > 0
