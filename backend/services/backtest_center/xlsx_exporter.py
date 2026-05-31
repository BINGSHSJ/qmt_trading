from __future__ import annotations

from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


MAX_CELL_TEXT_LENGTH = 32767


def write_xlsx(path: Path, sheets: list[tuple[str, list[str], list[list[Any]]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", _content_types(len(sheets)))
        workbook.writestr("_rels/.rels", _root_rels())
        workbook.writestr("docProps/core.xml", _core_props())
        workbook.writestr("docProps/app.xml", _app_props())
        workbook.writestr("xl/workbook.xml", _workbook_xml(sheets))
        workbook.writestr("xl/_rels/workbook.xml.rels", _workbook_rels(len(sheets)))
        workbook.writestr("xl/styles.xml", _styles_xml())
        for index, (name, headers, rows) in enumerate(sheets, start=1):
            workbook.writestr(f"xl/worksheets/sheet{index}.xml", _sheet_xml(headers, rows))


def _content_types(sheet_count: int) -> str:
    sheets = "\n".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  {sheets}
</Types>'''


def _root_rels() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''


def _core_props() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>本地量化控制台</dc:creator>
  <dc:title>回测完整记录</dc:title>
</cp:coreProperties>'''


def _app_props() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Local Quant Console</Application>
</Properties>'''


def _workbook_xml(sheets: list[tuple[str, list[str], list[list[Any]]]]) -> str:
    sheet_xml = "\n".join(
        f'<sheet name="{escape(_sheet_name(name))}" sheetId="{index}" r:id="rId{index}"/>'
        for index, (name, _, _) in enumerate(sheets, start=1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    {sheet_xml}
  </sheets>
</workbook>'''


def _workbook_rels(sheet_count: int) -> str:
    rels = "\n".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, sheet_count + 1)
    )
    style_rel = sheet_count + 1
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {rels}
  <Relationship Id="rId{style_rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''


def _styles_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Microsoft YaHei UI"/></font>
    <font><b/><sz val="11"/><name val="Microsoft YaHei UI"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''


def _sheet_xml(headers: list[str], rows: list[list[Any]]) -> str:
    all_rows = [headers, *rows]
    cells = []
    for row_index, row in enumerate(all_rows, start=1):
        row_cells = []
        for col_index, value in enumerate(row, start=1):
            row_cells.append(_cell_xml(row_index, col_index, value, header=row_index == 1))
        cells.append(f'<row r="{row_index}">{"".join(row_cells)}</row>')
    widths = "".join(
        f'<col min="{index}" max="{index}" width="{_column_width(index, all_rows)}" customWidth="1"/>'
        for index in range(1, len(headers) + 1)
    )
    dimension = f"A1:{_column_name(max(len(headers), 1))}{max(len(all_rows), 1)}"
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="{dimension}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>{widths}</cols>
  <sheetData>
    {"".join(cells)}
  </sheetData>
  <autoFilter ref="{dimension}"/>
</worksheet>'''


def _cell_xml(row_index: int, col_index: int, value: Any, header: bool) -> str:
    ref = f"{_column_name(col_index)}{row_index}"
    style = ' s="1"' if header else ""
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"{style}><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{style}><v>{value}</v></c>'
    text = _format_text(value)
    return f'<c r="{ref}" t="inlineStr"{style}><is><t>{escape(text)}</t></is></c>'


def _format_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if len(text) > MAX_CELL_TEXT_LENGTH:
        return f"{text[:MAX_CELL_TEXT_LENGTH - 20]}...（已截断）"
    return text


def _column_width(index: int, rows: list[list[Any]]) -> int:
    values = [_format_text(row[index - 1]) for row in rows if len(row) >= index]
    longest = max((len(value) for value in values), default=10)
    return max(10, min(longest + 2, 60))


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _sheet_name(name: str) -> str:
    sanitized = "".join("_" if char in r'[]:*?/\\' else char for char in name)
    return sanitized[:31] or "Sheet"
