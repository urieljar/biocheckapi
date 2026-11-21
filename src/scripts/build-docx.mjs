import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const mdPath = resolve('biocheckapi/INTEGRACION_V3.md');
const outDocxPath = resolve('biocheckapi/INTEGRACION_V3_MANUAL.docx');
const outDocxRootPath = resolve('INTEGRACION_V3_MANUAL.docx');

const mdContent = readFileSync(mdPath, 'utf8');

const xmlEscape = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

// OpenXML Elements Generator
function createRun(text, { bold = false, italic = false, code = false, color = null, size = 22 } = {}) {
  let rPr = '<w:rPr>';
  if (bold) rPr += '<w:b/>';
  if (italic) rPr += '<w:i/>';
  if (code) {
    rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    rPr += '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>';
    rPr += '<w:color w:val="B91C1C"/>';
    rPr += '<w:sz w:val="20"/>';
  } else {
    rPr += '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>';
    if (color) rPr += `<w:color w:val="${color}"/>`;
    rPr += `<w:sz w:val="${size}"/>`;
  }
  rPr += '</w:rPr>';
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function parseInline(text, defaultOptions = {}) {
  // Handles **bold**, `code`, *italic*
  const tokens = [];
  let remaining = text;

  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/;

  while (remaining) {
    const match = remaining.match(regex);
    if (!match) {
      tokens.push(createRun(remaining, defaultOptions));
      break;
    }

    const before = remaining.slice(0, match.index);
    if (before) tokens.push(createRun(before, defaultOptions));

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(createRun(token.slice(2, -2), { ...defaultOptions, bold: true }));
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(createRun(token.slice(1, -1), { ...defaultOptions, code: true }));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(createRun(token.slice(1, -1), { ...defaultOptions, italic: true }));
    }

    remaining = remaining.slice(match.index + token.length);
  }

  return tokens.join('');
}

function createParagraph(runsXml, { spacingBefore = 80, spacingAfter = 80, align = 'left', indent = 0 } = {}) {
  let pPr = '<w:pPr>';
  pPr += `<w:jc w:val="${align}"/>`;
  pPr += `<w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/>`;
  if (indent > 0) {
    pPr += `<w:ind w:left="${indent}"/>`;
  }
  pPr += '</w:pPr>';
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

function createHeading(text, level) {
  let color = '1E3A8A';
  let size = 36; // 18pt
  let before = 280;
  let after = 120;

  if (level === 2) {
    color = '0284C7';
    size = 28; // 14pt
    before = 220;
    after = 80;
  } else if (level === 3) {
    color = '334155';
    size = 24; // 12pt
    before = 160;
    after = 60;
  }

  const run = createRun(text, { bold: true, color, size });
  return createParagraph(run, { spacingBefore: before, spacingAfter: after });
}

function createCallout(text) {
  const run = parseInline(text, { color: '1E293B', size: 21 });
  let pPr = '<w:pPr>';
  pPr += '<w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="0284C7"/></w:pBdr>';
  pPr += '<w:shd w:val="clear" w:color="auto" w:fill="F0F9FF"/>';
  pPr += '<w:ind w:left="280" w:right="200"/>';
  pPr += '<w:spacing w:before="140" w:after="140" w:line="260" w:lineRule="auto"/>';
  pPr += '</w:pPr>';
  return `<w:p>${pPr}${run}</w:p>`;
}

function createCodeBlock(lines) {
  const pList = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const run = createRun(line || ' ', { code: false, size: 19 });
    let pPr = '<w:pPr>';
    pPr += '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="0F172A"/><w:sz w:val="19"/></w:rPr>';
    pPr += '<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>';
    pPr += '<w:ind w:left="240" w:right="200"/>';
    pPr += `<w:spacing w:before="${i === 0 ? 120 : 0}" w:after="${i === lines.length - 1 ? 120 : 0}" w:line="240" w:lineRule="auto"/>`;
    pPr += '</w:pPr>';
    pList.push(`<w:p>${pPr}${run}</w:p>`);
  }
  return pList.join('');
}

function createTable(rows) {
  // rows is array of array of strings
  let tbl = '<w:tbl>';
  tbl += '<w:tblPr>';
  tbl += '<w:tblW w:w="5000" w:type="pct"/>';
  tbl += '<w:tblBorders>';
  tbl += '<w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>';
  tbl += '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>';
  tbl += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>';
  tbl += '<w:insideV w:val="none"/>';
  tbl += '<w:left w:val="none"/>';
  tbl += '<w:right w:val="none"/>';
  tbl += '</w:tblBorders>';
  tbl += '</w:tblPr>';

  rows.forEach((row, rIdx) => {
    tbl += '<w:tr>';
    const isHeader = rIdx === 0;
    row.forEach((cellText) => {
      const bgColor = isHeader ? '1E3A8A' : rIdx % 2 === 1 ? 'FFFFFF' : 'F8FAFC';
      const textColor = isHeader ? 'FFFFFF' : '1E293B';
      const cellRun = parseInline(cellText.trim(), { bold: isHeader, color: textColor, size: isHeader ? 21 : 20 });
      
      tbl += '<w:tc>';
      tbl += '<w:tcPr>';
      tbl += `<w:shd w:val="clear" w:color="auto" w:fill="${bgColor}"/>`;
      tbl += '<w:tcMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar>';
      tbl += '</w:tcPr>';
      tbl += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${cellRun}</w:p>`;
      tbl += '</w:tc>';
    });
    tbl += '</w:tr>';
  });

  tbl += '</w:tbl>';
  return tbl;
}

// Convert Markdown to OpenXML Body
const bodyXmlParts = [];

// Header / Title banner
bodyXmlParts.push(createParagraph(
  createRun('MANUAL TÉCNICO DE INTEGRACIÓN', { bold: true, color: '0284C7', size: 24 }),
  { spacingBefore: 0, spacingAfter: 40, align: 'left' }
));
bodyXmlParts.push(createParagraph(
  createRun('BioCheck API v3: Clock Gateway (ZKTeco)', { bold: true, color: '1E3A8A', size: 44 }),
  { spacingBefore: 40, spacingAfter: 100, align: 'left' }
));
bodyXmlParts.push(createParagraph(
  createRun('Puente de Hardware para Conexión con Sistemas Externos (ERP, Nóminas, Control de Acceso) · Documentación de Arquitectura, Endpoints y Ejemplos de Implementación', { italic: true, color: '64748B', size: 21 }),
  { spacingBefore: 0, spacingAfter: 240, align: 'left' }
));

const rawLines = mdContent.split(/\r?\n/);
let inCode = false;
let codeBuffer = [];
let tableBuffer = [];

for (let i = 0; i < rawLines.length; i++) {
  const line = rawLines[i];

  if (line.startsWith('```')) {
    if (inCode) {
      bodyXmlParts.push(createCodeBlock(codeBuffer));
      codeBuffer = [];
      inCode = false;
    } else {
      inCode = true;
      codeBuffer = [];
    }
    continue;
  }

  if (inCode) {
    codeBuffer.push(line);
    continue;
  }

  // Handle tables
  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    if (line.includes('---')) {
      // separator line, skip
      continue;
    }
    const cells = line.split('|').slice(1, -1);
    tableBuffer.push(cells);
    continue;
  } else if (tableBuffer.length > 0) {
    bodyXmlParts.push(createTable(tableBuffer));
    tableBuffer = [];
  }

  if (!line.trim()) continue;

  if (line.startsWith('# ')) {
    bodyXmlParts.push(createHeading(line.slice(2).trim(), 1));
  } else if (line.startsWith('## ')) {
    bodyXmlParts.push(createHeading(line.slice(3).trim(), 2));
  } else if (line.startsWith('### ')) {
    bodyXmlParts.push(createHeading(line.slice(4).trim(), 3));
  } else if (line.startsWith('#### ')) {
    bodyXmlParts.push(createHeading(line.slice(5).trim(), 3));
  } else if (line.startsWith('> ')) {
    bodyXmlParts.push(createCallout(line.slice(2).trim()));
  } else if (line.startsWith('- ') || line.startsWith('* ')) {
    const bulletText = line.slice(2).trim();
    const run = parseInline(bulletText, { color: '1E293B', size: 22 });
    const bulletChar = createRun('• ', { bold: true, color: '0284C7', size: 24 });
    bodyXmlParts.push(createParagraph(bulletChar + run, { spacingBefore: 40, spacingAfter: 40, indent: 360 }));
  } else {
    bodyXmlParts.push(createParagraph(parseInline(line.trim(), { color: '1E293B', size: 22 }), { spacingBefore: 60, spacingAfter: 60 }));
  }
}

if (tableBuffer.length > 0) {
  bodyXmlParts.push(createTable(tableBuffer));
}

// Assemble full OpenXML files
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXmlParts.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// Write to temp dir
const tempDir = resolve('.local/docx_staging');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(join(tempDir, 'word'), { recursive: true });
mkdirSync(join(tempDir, '_rels'), { recursive: true });

writeFileSync(join(tempDir, '[Content_Types].xml'), contentTypesXml, 'utf8');
writeFileSync(join(tempDir, '_rels/.rels'), relsXml, 'utf8');
writeFileSync(join(tempDir, 'word/document.xml'), documentXml, 'utf8');

// Pack using PowerShell ZipFile
const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path '${outDocxPath}') { Remove-Item -Force '${outDocxPath}' }; [System.IO.Compression.ZipFile]::CreateFromDirectory('${tempDir}', '${outDocxPath}'); Copy-Item -Force '${outDocxPath}' '${outDocxRootPath}'"`;
execSync(psCommand, { stdio: 'inherit' });

rmSync(tempDir, { recursive: true, force: true });

console.log('✓ Documento Word generado exitosamente:');
console.log('  -> ' + outDocxPath);
console.log('  -> ' + outDocxRootPath);
