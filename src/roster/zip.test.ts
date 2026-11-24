// zip.ts 테스트: 직접 조립한 ZIP(데이터 디스크립터 방식 포함)
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip } from './zip';
import { RosterError } from './types';

interface F {
  name: string;
  data: Uint8Array;
  method: 0 | 8;
}

/** 로컬 헤더 크기를 0 으로 두고 bit 3 을 켠 ZIP 조립(중앙 디렉터리에만 크기) */
function buildZip(files: F[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  const push = (u: Uint8Array) => {
    chunks.push(u);
    offset += u.length;
  };
  for (const f of files) {
    const name = enc.encode(f.name);
    const comp = f.method === 8 ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0808, true);
    lv.setUint16(8, f.method, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const localOffset = offset;
    push(lh);
    push(comp);
    push(new Uint8Array(16)); // 데이터 디스크립터(내용 무시됨)
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0808, true);
    cv.setUint16(10, f.method, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    ch.set(name, 46);
    central.push(ch);
  }
  const cdStart = offset;
  for (const c of central) push(c);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, offset - cdStart, true);
  ev.setUint32(16, cdStart, true);
  push(eocd);
  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out.buffer;
}

describe('readZip', () => {
  const enc = new TextEncoder();
  const longText = '가나다 hello '.repeat(200);

  it('저장·deflate 항목을 중앙 디렉터리 기준으로 읽는다', async () => {
    const zip = await readZip(
      buildZip([
        { name: 'a.txt', data: enc.encode('안녕'), method: 0 },
        { name: 'dir/b.txt', data: enc.encode(longText), method: 8 },
        { name: 'c.bin', data: new Uint8Array([1, 2, 3, 255]), method: 8 },
      ]),
    );
    expect(zip.names).toEqual(['a.txt', 'dir/b.txt', 'c.bin']);
    expect(await zip.text('a.txt')).toBe('안녕');
    expect(await zip.text('dir/b.txt')).toBe(longText);
    expect([...(await zip.bytes('c.bin'))!]).toEqual([1, 2, 3, 255]);
  });

  it('없는 경로는 null', async () => {
    const zip = await readZip(buildZip([{ name: 'a.txt', data: enc.encode('x'), method: 0 }]));
    expect(await zip.text('none')).toBeNull();
    expect(await zip.bytes('none')).toBeNull();
  });

  it('ZIP 이 아니면 RosterError', async () => {
    await expect(readZip(enc.encode('이건 zip 이 아닙니다 '.repeat(5)).buffer as ArrayBuffer)).rejects.toBeInstanceOf(RosterError);
    await expect(readZip(new ArrayBuffer(5))).rejects.toBeInstanceOf(RosterError);
  });
});
