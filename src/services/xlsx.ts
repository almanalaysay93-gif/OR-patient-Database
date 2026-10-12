import { strToU8, zipSync } from "fflate";

export type Cell = string | number | null | undefined;

export interface Sheet {
  name: string;
  /** First row is the header. */
  rows: Cell[][];
}

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

function escapeXml(text: string): string {
  return text
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel limits: 31 characters, none of \ / ? * [ ] : */
function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 28)} ${i}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function sheetXml(rows: Cell[][]): string {
  const widths: number[] = [];
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      if (value == null || value === "") return "";
      const ref = `${columnLetter(c)}${r + 1}`;
      const style = r === 0 ? ` s="1"` : "";
      widths[c] = Math.max(widths[c] ?? 0, Math.min(String(value).length, 60));
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      // Text is always written as an inline string, so a value starting with "=" stays text and is never run as a formula.
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const cols = widths.length
    ? `<cols>${Array.from(widths, (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(w ?? 0, 8) + 2}" customWidth="1"/>`).join("")}</cols>`
    : "";
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** Builds a minimal .xlsx workbook: one worksheet per entry, bold frozen header row. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet.");
  const taken = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, taken));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`),
    "xl/workbook.xml": strToU8(
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });
  return zipSync(files, { level: 6 });
}
