/**
 * 명렬표 로컬 저장소 (IndexedDB)
 * 공개 API:
 * - listRosters(): 저장된 명렬표 목록 (addedAt 오름차순)
 * - addRoster(fileName, parsed): 명렬표 저장 후 반환
 * - removeRoster(id): 단일 삭제
 * - clearRosters(): 전체 삭제
 * 데이터는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.
 */
import type { ParsedRoster, RosterFile } from './types';

const DB_NAME = 'taja-roster';
const DB_VERSION = 1;
const STORE_NAME = 'files';

// DB 연결을 지연 초기화하고 성공 후 재사용
let dbPromise: Promise<IDBDatabase> | null = null;

// id 생성: randomUUID 우선, 없으면 대체 문자열
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      reject(new Error('이 브라우저에서는 명렬표를 저장할 수 없습니다.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      // 실패 시 캐시 초기화 → 다음 호출에서 재시도 가능
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDB를 열 수 없습니다.'));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('다른 탭이 DB 업그레이드를 막고 있습니다.'));
    };
  });
  return dbPromise;
}

// IDBRequest → Promise
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청 실패'));
  });
}

// 트랜잭션 완료 대기: oncomplete 성공, onerror/onabort 실패
function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('트랜잭션 실패'));
    tx.onabort = () => reject(tx.error ?? new Error('트랜잭션 중단'));
  });
}

export async function listRosters(): Promise<RosterFile[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const rows = await toPromise(tx.objectStore(STORE_NAME).getAll() as IDBRequest<RosterFile[]>);
  return rows.sort((a, b) => a.addedAt - b.addedAt);
}

export async function addRoster(fileName: string, parsed: ParsedRoster): Promise<RosterFile> {
  const db = await openDb();
  const record: RosterFile = { ...parsed, id: makeId(), fileName, addedAt: Date.now() };
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(record); // Blob 사진 포함 전체 저장
  await waitTx(tx);
  return record;
}

export async function removeRoster(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await waitTx(tx);
}

export async function clearRosters(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await waitTx(tx);
}
