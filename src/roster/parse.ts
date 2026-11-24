// 나이스 '사진명렬표' 엑셀(.xlsx)을 브라우저 안에서 읽는다(서버 전송 없음).
//   parseRoster(data)     xlsx 바이트 → ParsedRoster (사진은 Blob)
//   parseRosterXml(parts) 순수 함수. XML 문자열만으로 학생·사진 경로를 뽑는다(테스트용)
// 이름 셀 '1번  홍길동' 을 찾고, 사진은 그림 앵커(col, row) 의 바로 아래 행 같은 열 셀과 짝짓는다.
import { readZip } from './zip';
import { RosterError, type ParsedRoster } from './types';

export interface RosterXmlParts {
  sharedStrings: string;
  sheet: string;
  drawing: string | null;
  drawingRels: string | null;
}

export interface ParsedRosterXml {
  title: string;
  year: number;
  grade: number;
  classNo: number | null;
  students: { grade: number; classNo: number; number: number; name: string; photoPath: string | null }[];
}

const BAD_FORMAT = '사진명렬표 형식이 아닙니다. 나이스에서 저장한 사진명렬표 엑셀 파일을 선택하세요.';

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g: string) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    const map: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return map[g] ?? m;
  });
}

/** <t> 안의 글자만 이어 붙임(rPh 후리가나는 제외) */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? '';
  return unescapeXml(out);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
}

/** 'AB12' → { col: 27(0기준), row: 11(0기준) } */
function cellPos(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

interface Cell {
  col: number;
  row: number;
  text: string;
}

function readCells(sheet: string, shared: string[]): Cell[] {
  const cells: Cell[] = [];
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const body = m[2];
    if (!body) continue;
    const pos = cellPos(attr(m[1], 'r') ?? '');
    if (!pos) continue;
    const t = attr(m[1], 't');
    let text = '';
    if (t === 'inlineStr') text = textOf(body);
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (v === undefined) continue;
      text = t === 's' ? (shared[Number(v)] ?? '') : unescapeXml(v);
    }
    cells.push({ ...pos, text });
  }
  return cells;
}

function resolvePath(base: string, rel: string): string {
  const parts = base.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** 그림 앵커 → "열,행" (0기준, 이름 셀 위치 = 앵커 행 + 1) 별 이미지 경로 */
function readAnchors(drawing: string, rels: string | null): Map<string, string> {
  const relMap = new Map<string, string>();
  for (const m of (rels ?? '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) relMap.set(id, target);
  }
  const out = new Map<string, string>();
  for (const m of drawing.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
    const block = m[0];
    const col = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/.exec(block)?.[1];
    const row = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(block)?.[1];
    const rid = /<a:blip\b[^>]*?\sr:embed="([^"]+)"/.exec(block)?.[1];
    const target = rid ? relMap.get(rid) : undefined;
    if (col === undefined || row === undefined || !target) continue;
    // '../media/image1.jpeg' → 'xl/media/image1.jpeg'
    const path = target.startsWith('/') ? target.slice(1) : resolvePath('xl/drawings', target);
    out.set(`${col},${Number(row) + 1}`, path);
  }
  return out;
}

export function parseRosterXml(parts: RosterXmlParts): ParsedRosterXml {
  const shared = parseSharedStrings(parts.sharedStrings);
  const cells = readCells(parts.sheet, shared);

  // 제목: '2026학년도 3학년 3반' / '2026학년도 1학년 전체반'
  let title = '';
  let year = 0;
  let grade = 0;
  let classNo: number | null = null;
  for (const c of cells) {
    const m = /(\d{4})\s*학년도\s*(\d+)\s*학년\s*(?:(\d+)\s*반|전체\s*반)/.exec(c.text);
    if (m) {
      title = m[0].replace(/\s+/g, ' ');
      year = Number(m[1]);
      grade = Number(m[2]);
      classNo = m[3] ? Number(m[3]) : null;
      break;
    }
  }

  const anchors = parts.drawing ? readAnchors(parts.drawing, parts.drawingRels) : new Map<string, string>();

  const named: { c: Cell; number: number; name: string }[] = [];
  for (const c of cells) {
    const m = /^\s*(\d+)\s*번\s+(\S[\s\S]*?)\s*$/.exec(c.text);
    if (m) named.push({ c, number: Number(m[1]), name: m[2] });
  }
  named.sort((a, b) => a.c.row - b.c.row || a.c.col - b.c.col);

  const students: ParsedRosterXml['students'] = [];
  let cls = classNo ?? 1;
  let prev = 0;
  for (const { c, number, name } of named) {
    if (classNo === null && prev > 0 && number <= prev) cls++;
    prev = number;
    students.push({ grade, classNo: cls, number, name, photoPath: anchors.get(`${c.col},${c.row}`) ?? null });
  }
  return { title, year, grade, classNo, students };
}

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}
function baseOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export async function parseRoster(data: ArrayBuffer): Promise<ParsedRoster> {
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new RosterError(
      "옛 형식(.xls) 파일입니다. 엑셀에서 열어 '다른 이름으로 저장 → Excel 통합 문서(.xlsx)'로 저장한 뒤 다시 선택하세요.",
    );
  }
  const zip = await readZip(data);

  // workbook 을 따라 첫 시트 경로 찾기. 못 찾으면 기본 경로
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await zip.text('xl/workbook.xml');
  const wbRels = await zip.text('xl/_rels/workbook.xml.rels');
  if (wb && wbRels) {
    const rid = /<sheet\b[^>]*?\sr:id="([^"]+)"/.exec(wb)?.[1];
    if (rid) {
      for (const m of wbRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        const t = attr(m[1], 'Target');
        if (attr(m[1], 'Id') === rid && t) sheetPath = t.startsWith('/') ? t.slice(1) : resolvePath('xl', t);
      }
    }
  }
  const sheet = (await zip.text(sheetPath)) ?? (await zip.text('xl/worksheets/sheet1.xml'));
  if (!sheet) throw new RosterError(BAD_FORMAT);

  // 시트 → 그림 경로
  let drawingPath = 'xl/drawings/drawing1.xml';
  const sheetRels = await zip.text(`${dirOf(sheetPath)}/_rels/${baseOf(sheetPath)}.rels`);
  if (sheetRels) {
    for (const m of sheetRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const t = attr(m[1], 'Target');
      if (t && /drawing/i.test(attr(m[1], 'Type') ?? '')) {
        drawingPath = t.startsWith('/') ? t.slice(1) : resolvePath(dirOf(sheetPath), t);
      }
    }
  }
  const drawing = await zip.text(drawingPath);
  const drawingRels = await zip.text(`${dirOf(drawingPath)}/_rels/${baseOf(drawingPath)}.rels`);

  const parsed = parseRosterXml({
    sharedStrings: (await zip.text('xl/sharedStrings.xml')) ?? '',
    sheet,
    drawing,
    drawingRels,
  });
  if (parsed.students.length === 0) throw new RosterError(BAD_FORMAT);

  const students: ParsedRoster['students'] = [];
  for (const s of parsed.students) {
    let photo: Blob | null = null;
    if (s.photoPath) {
      const bytes = await zip.bytes(s.photoPath);
      if (bytes) photo = new Blob([bytes as BlobPart], { type: mimeOf(s.photoPath) });
    }
    students.push({ grade: s.grade, classNo: s.classNo, number: s.number, name: s.name, photo });
  }
  return { title: parsed.title, year: parsed.year, grade: parsed.grade, classNo: parsed.classNo, students };
}
