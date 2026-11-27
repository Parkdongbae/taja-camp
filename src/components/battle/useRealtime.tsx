// 실시간 서버(배틀·접속 현황) 연결 상태와 안내 문구.
//   useRealtimeStatus(): 'checking' | 'ok' | 'down'   — 6초 안에 연결되지 않거나 끊긴 채 6초가 지나면 'down'
//   RealtimeDownNotice   — 'down' 일 때 보여 줄 안내 상자(학교 망 차단 가능성과 해결 방법)
import { useEffect, useState } from 'react';
import { backend } from '../../data';

export type RealtimeStatus = 'checking' | 'ok' | 'down';
const WAIT_MS = 6000;

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('checking');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => setStatus('down'), WAIT_MS);
    const off = backend.watchConnection((ok) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (ok) setStatus('ok');
      else timer = setTimeout(() => setStatus('down'), WAIT_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, []);
  return status;
}

export function RealtimeDownNotice({ dark = true }: { dark?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ${dark ? 'bg-miss/20 text-white' : 'bg-red-50 text-ink'}`}>
      <b>실시간 배틀 서버에 연결되지 않았어요.</b> 학교 인터넷에서 <code>*.firebasedatabase.app</code> 주소나 웹소켓 연결이 막혀 있을 수 있어요.
      컴퓨터 대결은 그대로 할 수 있어요. 선생님은 정보 담당 선생님께 위 주소의 접속(웹소켓 포함) 허용을 요청해 주세요.
    </div>
  );
}
