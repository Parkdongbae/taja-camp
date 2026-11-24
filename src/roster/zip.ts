// ZIP 읽기(브라우저·Node 18+ 공용, 라이브러리 없음).
//   readZip(data)  ZipArchive 반환. ZIP 이 아니면 RosterError
//   ZipArchive     names / text(path) (UTF-8) / bytes(path)
// 끝의 중앙 디렉터리에서 크기·오프셋을 읽는다(로컬 헤더 크기가 0 인 파일 대응). 방식 0·8 만 지원.
import { RosterError } from './types';

export interface ZipArchive {
  names: string[];
  text(path: string): Promise<string | null>;
  bytes(path: string): Promise<Uint8Array | null>;
}

interface Entry {
  method: number;
  csize: number;
  offset: number;
}

const NOT_ZIP = '엑셀(.xlsx) 파일이 아니거나 손상된 파일입니다.';

async function inflateRaw(src: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(data: ArrayBuffer): Promise<ZipArchive> {
  const buf = new Uint8Array(data);
  const dv = new DataView(data);
  if (buf.length < 22) throw new RosterError(NOT_ZIP);

  // EOCD 찾기(뒤에서부터, 주석 최대 65535 바이트)
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new RosterError(NOT_ZIP);

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const entries = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new RosterError(NOT_ZIP);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, csize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const bytes = async (path: string): Promise<Uint8Array | null> => {
    const e = entries.get(path);
    if (!e) return null;
    if (e.offset + 30 > buf.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new RosterError(NOT_ZIP);
    const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
    const raw = buf.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) {
      try {
        return await inflateRaw(raw);
      } catch {
        throw new RosterError('파일 안의 압축 자료를 풀지 못했습니다. 파일이 손상되었을 수 있습니다.');
      }
    }
    throw new RosterError('지원하지 않는 압축 방식의 파일입니다.');
  };

  return {
    names: [...entries.keys()],
    bytes,
    async text(path) {
      const b = await bytes(path);
      return b ? dec.decode(b) : null;
    },
  };
}
