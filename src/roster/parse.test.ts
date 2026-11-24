// parse.ts 테스트: 가짜 이름으로 만든 작은 XML
import { describe, it, expect } from 'vitest';
import { parseRosterXml, parseRoster } from './parse';
import { RosterError } from './types';

const sst = (items: string[]) =>
  `<sst>${items.map((s) => `<si><t xml:space="preserve">${s}</t></si>`).join('')}</sst>`;

// 문자열 인덱스 → 셀
const cell = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;

function anchor(col: number, row: number, rid: string) {
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col + 1}</xdr:col><xdr:row>${row + 1}</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="${rid}"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>`;
}
const rels = `<Relationships><Relationship Id="rId1" Type="x" Target="../media/image1.jpeg"/><Relationship Id="rId2" Target="../media/image2.png" Type="y"/></Relationships>`;

describe('parseRosterXml', () => {
  it('반별 파일: 제목·학생·사진 짝짓기·엔티티·번호 빈칸', () => {
    const strings = [
      '사진명렬표',
      '2026학년도 3학년 3반',
      '1번  가나다',
      '2번  A &amp; B &#xD55C;',
      '4번  Ma Li  Na',
      '3번  라마바',
    ];
    const sheet = `<worksheet><sheetData>
      <row r="4">${cell('E4', 0)}</row>
      <row r="6">${cell('B6', 1)}</row>
      <row r="9">${cell('B9', 2)}${cell('D9', 3)}<c r="G9" s="3"/>${cell('I9', 4)}</row>
      <row r="12">${cell('B12', 5)}</row>
    </sheetData></worksheet>`;
    // 앵커(1,7)→B9, (3,7)→D9, (1,10)→B12 ; I9 는 사진 없음
    const drawing = `<xdr:wsDr>${anchor(1, 7, 'rId1')}${anchor(3, 7, 'rId2')}${anchor(1, 10, 'rId1')}</xdr:wsDr>`;
    const r = parseRosterXml({ sharedStrings: sst(strings), sheet, drawing, drawingRels: rels });
    expect(r).toMatchObject({ title: '2026학년도 3학년 3반', year: 2026, grade: 3, classNo: 3 });
    expect(r.students.map((s) => [s.number, s.name, s.classNo, s.photoPath])).toEqual([
      [1, '가나다', 3, 'xl/media/image1.jpeg'],
      [2, 'A & B 한', 3, 'xl/media/image2.png'],
      [4, 'Ma Li  Na', 3, null],
      [3, '라마바', 3, 'xl/media/image1.jpeg'],
    ]);
  });

  it('학년 전체 파일: 번호가 되돌아가면 다음 반', () => {
    const strings = ['2026학년도 1학년 전체반', '1번  가', '2번  나', '1번  다', '2번  라', '1번  마'];
    const sheet = `<worksheet><sheetData>
      <row r="6">${cell('B6', 0)}</row>
      <row r="9">${cell('B9', 1)}${cell('D9', 2)}</row>
      <row r="12">${cell('B12', 3)}${cell('D12', 4)}</row>
      <row r="15">${cell('B15', 5)}</row>
    </sheetData></worksheet>`;
    const r = parseRosterXml({ sharedStrings: sst(strings), sheet, drawing: null, drawingRels: null });
    expect(r.classNo).toBeNull();
    expect(r.grade).toBe(1);
    expect(r.students.map((s) => [s.classNo, s.number, s.photoPath])).toEqual([
      [1, 1, null],
      [1, 2, null],
      [2, 1, null],
      [2, 2, null],
      [3, 1, null],
    ]);
  });

  it('제목이 없으면 0 / null, 1반부터', () => {
    const sheet = `<worksheet><sheetData><row r="9">${cell('B9', 0)}</row></sheetData></worksheet>`;
    const r = parseRosterXml({ sharedStrings: sst(['5번  가']), sheet, drawing: null, drawingRels: null });
    expect(r).toMatchObject({ year: 0, grade: 0, classNo: null });
    expect(r.students[0]).toMatchObject({ classNo: 1, number: 5, grade: 0 });
  });
});

describe('parseRoster 오류', () => {
  it('옛 .xls 는 안내 문구', async () => {
    const b = new Uint8Array(64);
    b.set([0xd0, 0xcf, 0x11, 0xe0]);
    const err = await parseRoster(b.buffer).catch((e) => e);
    expect(err).toBeInstanceOf(RosterError);
    expect(err.message).toContain('.xlsx');
  });

  it('ZIP 이 아니면 RosterError', async () => {
    const b = new Uint8Array(100).fill(65);
    await expect(parseRoster(b.buffer)).rejects.toBeInstanceOf(RosterError);
  });
});
