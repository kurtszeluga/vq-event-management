#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  TableOfContents,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
  Table,
  TableCell,
  TableRow
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'exports');
const LOGO_PATH = path.join(ROOT, 'public', 'assets', 'village-quilters-logo.png');

const COLORS = {
  heading: '225C56',
  meta: '5C6966',
  body: '1D2927',
  subtitle: '3B4B48',
  leadBg: 'F2F8F6',
  codeBg: 'FFF1DF',
  codeText: '8A4B00',
  rule: 'D8CFC2'
};

const PAGE_WIDTH_TWIPS = 12240;
const PAGE_MARGIN_TWIPS = 1440;
const CONTENT_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;

const DOCUMENTS = [
  {
    source: path.join(ROOT, 'APP_OVERVIEW.md'),
    output: path.join(OUT_DIR, 'VQ_Event_Management_App_Overview.docx'),
    title: 'VQ Event Management App Overview',
    subtitle: 'Summary of features, workflows, security, and current direction',
    audience: 'Guild leaders, administrators, coordinators, and stakeholders'
  },
  {
    source: path.join(ROOT, 'ROLE_CAPABILITIES_OVERVIEW.md'),
    output: path.join(OUT_DIR, 'VQ_Event_Management_Role_Capabilities_Overview.docx'),
    title: 'VQ Event Management Role Capabilities Overview',
    subtitle: 'Plain-language guide to what visitors, members, admins, super users, and coordinators can do',
    audience: 'Guild leaders, administrators, coordinators, and members'
  }
];

function parseMarkdown(source) {
  const blocks = [];
  let paraLines = [];
  let listItems = [];
  let listType = null;

  const flushPara = () => {
    if (paraLines.length) {
      blocks.push({ type: 'p', text: paraLines.join(' ').trim() });
      paraLines = [];
    }
  };

  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: listType, items: listItems });
      listItems = [];
      listType = null;
    }
  };

  for (const rawLine of readFileSync(source, 'utf8').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    const numberMatch = line.match(/^\s*\d+\.\s+(.+)$/);

    if (headingMatch) {
      flushPara();
      flushList();
      blocks.push({ type: `h${headingMatch[1].length}`, text: headingMatch[2].trim() });
    } else if (bulletMatch) {
      flushPara();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(bulletMatch[1].trim());
    } else if (numberMatch) {
      flushPara();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(numberMatch[1].trim());
    } else {
      flushList();
      paraLines.push(line.trim());
    }
  }

  flushPara();
  flushList();
  return blocks;
}

function textRuns(text, { bold = false } = {}) {
  return text
    .split(/(`[^`]+`)/g)
    .filter(Boolean)
    .map((part) => {
      const isCode = part.startsWith('`') && part.endsWith('`');

      if (isCode) {
        return new TextRun({
          text: part.slice(1, -1),
          font: 'Consolas',
          color: COLORS.codeText,
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.codeBg }
        });
      }

      return new TextRun({ text: part, bold });
    });
}

function buildHeader(meta, logoData) {
  const titleCell = new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    width: { size: CONTENT_WIDTH_TWIPS - convertInchesToTwip(0.55), type: WidthType.DXA },
    borders: NO_CELL_BORDERS,
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({ text: 'The Village Quilters Network', bold: true, color: COLORS.heading, size: 20 })
        ]
      })
    ]
  });

  const rowChildren = [titleCell];

  if (logoData) {
    rowChildren.unshift(
      new TableCell({
        verticalAlign: VerticalAlign.CENTER,
        width: { size: convertInchesToTwip(0.55), type: WidthType.DXA },
        borders: NO_CELL_BORDERS,
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({
                data: logoData,
                type: 'png',
                transformation: { width: 34, height: 34 }
              })
            ]
          })
        ]
      })
    );
  }

  const columnWidths = logoData
    ? [convertInchesToTwip(0.55), CONTENT_WIDTH_TWIPS - convertInchesToTwip(0.55)]
    : [CONTENT_WIDTH_TWIPS];

  return new Header({
    children: [
      new Table({
        width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
        columnWidths,
        borders: NO_TABLE_BORDERS,
        rows: [new TableRow({ children: rowChildren })]
      }),
      new Paragraph({
        spacing: { before: 60, after: 0 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.rule, space: 1 }
        },
        children: [new TextRun({ text: meta.title, bold: true, color: COLORS.body, size: 17 })]
      })
    ]
  });
}

const NO_CELL_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
};

const NO_TABLE_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
};

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
            color: COLORS.meta,
            size: 18
          })
        ]
      })
    ]
  });
}

function buildFrontMatter(meta, generatedOn) {
  return [
    new Paragraph({
      spacing: { before: 0, after: 180 },
      children: [new TextRun({ text: meta.subtitle, italics: true, color: COLORS.subtitle, size: 26 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: `Audience: ${meta.audience}`, color: COLORS.meta, size: 20 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 220 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.heading, space: 8 } },
      children: [new TextRun({ text: `Prepared: ${generatedOn}`, color: COLORS.meta, size: 20 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 320 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.leadBg },
      children: [
        new TextRun({
          text: 'This document provides a concise, non-technical overview of the current VQ Event Management application.',
          color: COLORS.body,
          size: 22
        })
      ]
    })
  ];
}

function buildToc() {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Contents')]
    }),
    new TableOfContents('Contents', {
      hyperlink: true,
      headingStyleRange: '1-2'
    }),
    new Paragraph({ children: [new TextRun('')], pageBreakBefore: true })
  ];
}

function buildBody(blocks) {
  const paragraphs = [];

  for (const block of blocks) {
    if (block.type === 'h1') {
      continue;
    }

    if (block.type === 'h2') {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: textRuns(block.text) }));
    } else if (block.type === 'h3') {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: textRuns(block.text) }));
    } else if (block.type === 'p') {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 160, line: 280, lineRule: 'auto' },
          children: textRuns(block.text)
        })
      );
    } else if (block.type === 'ul') {
      for (const item of block.items) {
        paragraphs.push(
          new Paragraph({
            numbering: { reference: 'bullet-list', level: 0 },
            spacing: { after: 80 },
            children: textRuns(item)
          })
        );
      }
    } else if (block.type === 'ol') {
      for (const item of block.items) {
        paragraphs.push(
          new Paragraph({
            numbering: { reference: 'number-list', level: 0 },
            spacing: { after: 80 },
            children: textRuns(item)
          })
        );
      }
    }
  }

  return paragraphs;
}

async function writeDocx(meta) {
  const blocks = parseMarkdown(meta.source);
  const logoData = existsSync(LOGO_PATH) ? readFileSync(LOGO_PATH) : null;
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const doc = new Document({
    creator: 'The Village Quilters Network',
    title: meta.title,
    subject: meta.subtitle,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: COLORS.body },
          paragraph: { spacing: { line: 264, lineRule: 'auto' } }
        },
        heading1: {
          run: { font: 'Calibri', size: 32, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 320, after: 120 } }
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 240, after: 100 } }
        }
      }
    },
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        },
        {
          reference: 'number-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH_TWIPS, height: 15840 },
            margin: { top: PAGE_MARGIN_TWIPS, bottom: PAGE_MARGIN_TWIPS, left: PAGE_MARGIN_TWIPS, right: PAGE_MARGIN_TWIPS }
          }
        },
        headers: { default: buildHeader(meta, logoData) },
        footers: { default: buildFooter() },
        children: [...buildFrontMatter(meta, generatedOn), ...buildToc(), ...buildBody(blocks)]
      }
    ]
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const outputBuffer = await Packer.toBuffer(doc);
  writeFileSync(meta.output, outputBuffer);
  return meta.output;
}

async function main() {
  for (const meta of DOCUMENTS) {
    const output = await writeDocx(meta);
    console.log(output);
  }
}

main();
