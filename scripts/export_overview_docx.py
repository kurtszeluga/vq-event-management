#!/usr/bin/env python3
import html
import os
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "exports"
LOGO_PATH = ROOT / "public" / "assets" / "village-quilters-logo.png"


DOCUMENTS = [
    {
        "source": ROOT / "APP_OVERVIEW.md",
        "output": OUT_DIR / "VQ_Event_Management_App_Overview.docx",
        "title": "VQ Event Management App Overview",
        "subtitle": "Summary of features, workflows, security, and current direction",
        "audience": "Guild leaders, administrators, coordinators, and stakeholders",
    },
    {
        "source": ROOT / "ROLE_CAPABILITIES_OVERVIEW.md",
        "output": OUT_DIR / "VQ_Event_Management_Role_Capabilities_Overview.docx",
        "title": "VQ Event Management Role Capabilities Overview",
        "subtitle": "Plain-language guide to what visitors, members, admins, super users, and coordinators can do",
        "audience": "Guild leaders, administrators, coordinators, and members",
    },
]


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "dcmitype": "http://purl.org/dc/dcmitype/",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}


def esc(value):
    return html.escape(str(value), quote=True)


def slug_to_title(value):
    return re.sub(r"\s+", " ", value.replace("_", " ").strip()).title()


def parse_markdown(path):
    blocks = []
    current_para = []
    current_list = []
    current_list_type = None

    def flush_para():
        nonlocal current_para
        if current_para:
            blocks.append({"type": "p", "text": " ".join(current_para).strip()})
            current_para = []

    def flush_list():
        nonlocal current_list, current_list_type
        if current_list:
            blocks.append({"type": current_list_type, "items": current_list})
            current_list = []
            current_list_type = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            flush_para()
            flush_list()
            continue

        heading_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        bullet_match = re.match(r"^\s*-\s+(.+)$", line)
        number_match = re.match(r"^\s*\d+\.\s+(.+)$", line)

        if heading_match:
            flush_para()
            flush_list()
            level = len(heading_match.group(1))
            blocks.append({"type": f"h{level}", "text": heading_match.group(2).strip()})
        elif bullet_match:
            flush_para()
            if current_list_type != "ul":
                flush_list()
                current_list_type = "ul"
            current_list.append(bullet_match.group(1).strip())
        elif number_match:
            flush_para()
            if current_list_type != "ol":
                flush_list()
                current_list_type = "ol"
            current_list.append(number_match.group(1).strip())
        else:
            flush_list()
            current_para.append(line.strip())

    flush_para()
    flush_list()
    return blocks


def text_runs(text, bold=False, color=None, size=None):
    parts = re.split(r"(`[^`]+`)", text)
    runs = []
    for part in parts:
        if not part:
            continue
        code = part.startswith("`") and part.endswith("`")
        content = part[1:-1] if code else part
        props = []
        if bold:
            props.append("<w:b/>")
        if code:
            props.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
            props.append('<w:color w:val="8A4B00"/>')
            props.append('<w:shd w:val="clear" w:color="auto" w:fill="FFF1DF"/>')
        elif color:
            props.append(f'<w:color w:val="{color}"/>')
        if size:
            props.append(f'<w:sz w:val="{size * 2}"/>')
        rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
        runs.append(f"<w:r>{rpr}<w:t xml:space=\"preserve\">{esc(content)}</w:t></w:r>")
    return "".join(runs)


def paragraph(text="", style=None, num_id=None, ilvl=0, bold=False, color=None, size=None, shading=None, border_bottom=None, align=None, page_break_before=False):
    props = []
    if style:
        props.append(f'<w:pStyle w:val="{style}"/>')
    if num_id is not None:
        props.append(f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr>')
    if shading:
        props.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{shading}"/>')
    if border_bottom:
        props.append(f'<w:pBdr><w:bottom w:val="single" w:sz="10" w:space="8" w:color="{border_bottom}"/></w:pBdr>')
    if align:
        props.append(f'<w:jc w:val="{align}"/>')
    if page_break_before:
        props.append("<w:pageBreakBefore/>")
    ppr = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
    return f"<w:p>{ppr}{text_runs(text, bold=bold, color=color, size=size)}</w:p>"


def image_paragraph(rel_id="rId4", size_inches=0.95):
    emu = int(size_inches * 914400)
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{emu}" cy="{emu}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="1" name="Village Quilters Logo"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
        </wp:cNvGraphicFramePr>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr>
                <pic:cNvPr id="0" name="village-quilters-logo.png"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="{rel_id}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu}" cy="{emu}"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
"""


def section_properties():
    return """
      <w:sectPr>
        <w:pgSz w:w="12240" w:h="15840"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
        <w:cols w:space="720"/>
        <w:docGrid w:linePitch="360"/>
      </w:sectPr>
    """


def document_xml(meta, blocks):
    body = []
    generated = datetime.now().strftime("%B %d, %Y")

    if LOGO_PATH.exists():
        body.append(image_paragraph())
    body.append(paragraph("The Village Quilters Network", style="Kicker"))
    body.append(paragraph(meta["title"], style="DocTitle"))
    body.append(paragraph(meta["subtitle"], style="Subtitle"))
    body.append(paragraph(f"Audience: {meta['audience']}", style="Meta"))
    body.append(paragraph(f"Prepared: {generated}", style="Meta", border_bottom="225C56"))
    body.append(paragraph(
        "This document provides a concise, non-technical overview of the current VQ Event Management application.",
        style="Lead",
        shading="F2F8F6",
    ))

    for block in blocks:
        if block["type"] == "h1":
            continue
        if block["type"] == "h2":
            body.append(paragraph(block["text"], style="Heading1"))
        elif block["type"] == "h3":
            body.append(paragraph(block["text"], style="Heading2"))
        elif block["type"] == "p":
            body.append(paragraph(block["text"], style="BodyText"))
        elif block["type"] == "ul":
            for item in block["items"]:
                body.append(paragraph(f"{chr(8226)}  {item}", style="ListParagraph"))
        elif block["type"] == "ol":
            for index, item in enumerate(block["items"], start=1):
                body.append(paragraph(f"{index}. {item}", style="ListParagraph"))

    body.append(section_properties())
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{NS['w']}" xmlns:r="{NS['r']}">
  <w:background w:color="FFFFFF"/>
  <w:body>
    {''.join(body)}
  </w:body>
</w:document>
"""


def styles_xml():
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{NS['w']}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="1D2927"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  {style('Normal', 'paragraph', 'Normal', based_on=None, size=11, after=120, line=264)}
  {style('BodyText', 'paragraph', 'Body Text', based_on='Normal', size=11, after=120, line=264)}
  {style('DocTitle', 'paragraph', 'Document Title', based_on='Normal', size=24, color='225C56', bold=True, before=0, after=120, line=300)}
  {style('Subtitle', 'paragraph', 'Subtitle', based_on='Normal', size=13, color='3B4B48', italic=True, before=0, after=180, line=264)}
  {style('Kicker', 'paragraph', 'Kicker', based_on='Normal', size=10, color='8A4B00', bold=True, before=0, after=40, caps=True)}
  {style('Meta', 'paragraph', 'Metadata', based_on='Normal', size=10, color='5C6966', before=0, after=60, line=240)}
  {style('Lead', 'paragraph', 'Lead Callout', based_on='Normal', size=11, color='1D2927', before=120, after=180, line=280)}
  {style('Heading1', 'paragraph', 'Heading 1', based_on='Normal', size=16, color='225C56', bold=True, before=320, after=120, line=300, outline=0)}
  {style('Heading2', 'paragraph', 'Heading 2', based_on='Normal', size=13, color='225C56', bold=True, before=240, after=100, line=280, outline=1)}
  {style('ListParagraph', 'paragraph', 'List Paragraph', based_on='Normal', size=11, after=80, line=280, indent_left=720)}
</w:styles>
"""


def style(style_id, typ, name, based_on="Normal", size=11, color="1D2927", bold=False, italic=False, before=0, after=120, line=264, caps=False, outline=None, indent_left=None):
    based = f'<w:basedOn w:val="{based_on}"/>' if based_on else ""
    p_props = [f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>']
    if outline is not None:
        p_props.append(f'<w:outlineLvl w:val="{outline}"/>')
    if indent_left is not None:
        p_props.append(f'<w:ind w:left="{indent_left}"/>')
    r_props = [
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>',
        f'<w:sz w:val="{size * 2}"/>',
        f'<w:color w:val="{color}"/>',
    ]
    if bold:
        r_props.append("<w:b/>")
    if italic:
        r_props.append("<w:i/>")
    if caps:
        r_props.append("<w:caps/>")
    return f"""
  <w:style w:type="{typ}" w:styleId="{style_id}">
    <w:name w:val="{name}"/>
    {based}
    <w:pPr>{''.join(p_props)}</w:pPr>
    <w:rPr>{''.join(r_props)}</w:rPr>
  </w:style>
"""


def numbering_xml():
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{NS['w']}">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#8226;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:abstractNum w:abstractNumId="2">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>
"""


def settings_xml():
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="{NS['w']}">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
  <w:compat/>
</w:settings>
"""


def content_types_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""


def root_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def doc_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/village-quilters-logo.png"/>
</Relationships>
"""


def core_xml(title):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="{NS['cp']}" xmlns:dc="{NS['dc']}" xmlns:dcterms="{NS['dcterms']}" xmlns:dcmitype="{NS['dcmitype']}" xmlns:xsi="{NS['xsi']}">
  <dc:title>{esc(title)}</dc:title>
  <dc:creator>OpenAI Codex</dc:creator>
  <cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def app_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company>The Village Quilters Network</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"""


def write_docx(meta):
    blocks = parse_markdown(meta["source"])
    output = meta["output"]
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types_xml())
        docx.writestr("_rels/.rels", root_rels_xml())
        docx.writestr("docProps/core.xml", core_xml(meta["title"]))
        docx.writestr("docProps/app.xml", app_xml())
        docx.writestr("word/document.xml", document_xml(meta, blocks))
        docx.writestr("word/styles.xml", styles_xml())
        docx.writestr("word/numbering.xml", numbering_xml())
        docx.writestr("word/settings.xml", settings_xml())
        docx.writestr("word/_rels/document.xml.rels", doc_rels_xml())
        if LOGO_PATH.exists():
            docx.writestr("word/media/village-quilters-logo.png", LOGO_PATH.read_bytes())
    return output


def main():
    for meta in DOCUMENTS:
        output = write_docx(meta)
        print(output)


if __name__ == "__main__":
    main()
