import { describe, expect, it } from 'vitest';
import { TypingMeter, compare, splitLines } from './judge';

describe('compare: 도깨비불·조합 중 상태는 오타가 아니다', () => {
  it.each([
    ['가나', ['ㄱ', '가', '간', '가나']],
    ['달기', ['ㄷ', '다', '달', '닭', '달기']],
    ['한글', ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']],
    ['앉아', ['ㅇ', '아', '안', '앉', '앉ㅇ', '앉아']],
    ['안자', ['안', '앉', '안자']],
    ['갈비', ['갈', '갋', '갈비']],
    ['값이', ['갑', '값', '값ㅇ', '값이']],
    ['갑시다', ['갑', '값', '갑시', '갑싣', '갑시다']],
    ['읽다', ['일', '읽', '읽ㄷ', '읽다']],
    ['과학', ['ㄱ', '고', '과', '괗', '과하', '과학']],
    ['의사', ['으', '의', '의ㅅ', '의사']],
    ['까치', ['ㄲ', '까', '깣', '까치']],
    ['있다', ['이', '있', '있ㄷ', '있다']],
  ])('%s', (target, steps) => {
    for (const s of steps) {
      const r = compare(target, s);
      expect(r.ok, `${target} ← ${s}`).toBe(true);
    }
    expect(compare(target, steps[steps.length - 1]).done).toBe(true);
  });
});

describe('compare: 오타 판정과 위치', () => {
  it('가나 ← 갇 : 3번째 자모(ㄴ 자리)에서 오타', () => {
    const r = compare('가나', '갇');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(2);
    expect(r.errorKey!.expected!.code).toBe('KeyS');
    expect(r.errorKey!.typed).toBe('ㄷ');
    expect(r.errorKey!.charIndex).toBe(1);
    expect(r.chars).toEqual(['error']);
    expect(r.targetStates).toEqual(['done', 'error']);
    expect(r.next).toBeNull();
  });
  it('쌍자음 자리에 홑자음: 까 ← 가', () => {
    const r = compare('까', '가');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(0);
    expect(r.errorKey!.expected).toMatchObject({ code: 'KeyR', shift: true });
  });
  it('홑자음 자리에 쌍자음: 가 ← 까', () => {
    const r = compare('가', '까');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.expected).toMatchObject({ code: 'KeyR', shift: false });
  });
  it('받침 쌍자음: 있다 ← 잇', () => {
    const r = compare('있다', '잇');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(2);
    expect(r.errorKey!.expected).toMatchObject({ code: 'KeyT', shift: true });
  });
  it('겹모음 일부만 맞음: 과학 ← 곻', () => {
    const r = compare('과학', '곻');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(2);
    expect(r.errorKey!.expected!.label).toBe('ㅏ');
  });
  it('겹받침: 닭 ← 닮', () => {
    const r = compare('닭', '닮');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(3);
  });
  it('겹받침 정상: 닭 ← 닭', () => {
    expect(compare('닭', '닭').done).toBe(true);
  });
  it('여러 글자 뒤 오타: 앞 글자는 ok, 뒤는 error', () => {
    const r = compare('나라 사랑', '나라 사란');
    expect(r.chars).toEqual(['ok', 'ok', 'ok', 'ok', 'error']);
    expect(r.targetStates).toEqual(['done', 'done', 'done', 'done', 'error']);
  });
  it('오타 뒤로 친 글자도 모두 error', () => {
    const r = compare('가나다', '거나다');
    expect(r.chars).toEqual(['error', 'error', 'error']);
    expect(r.targetStates).toEqual(['error', 'todo', 'todo']);
    expect(r.matchedKeys).toBe(1);
  });
  it('입력이 목표보다 길면 expected 는 null', () => {
    const r = compare('가', '가나');
    expect(r.ok).toBe(false);
    expect(r.done).toBe(false);
    expect(r.errorKey!.expected).toBeNull();
    expect(r.errorKey!.charIndex).toBe(1);
    expect(r.targetStates).toEqual(['done']);
  });
  it('공백 자리 오타', () => {
    const r = compare('DNA 구조', 'DNA구');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(3);
    expect(r.errorKey!.expected!.code).toBe('Space');
    expect(r.wrongLang).toBe(false);
  });
});

describe('compare: 영문·숫자·기호·혼용', () => {
  it.each([
    ['Hello', 'H', 2],
    ['Hello', 'He', 3],
    ['Hello', 'Hello', 6],
    ['Hello!', 'Hello!', 8],
    ['a1!', 'a1', 2],
    ['a1!', 'a1!', 4],
    ['DNA 구조', 'DNA ', 7],
    ['DNA 구조', 'DNA 구', 9],
    ['2개의 사과', '2개', 3],
    ['x = 3', 'x = ', 4],
  ])('%j ← %j : ok, matchedKeys %i', (t, i, n) => {
    const r = compare(t, i);
    expect(r.ok).toBe(true);
    expect(r.matchedKeys).toBe(n);
  });
  it('대소문자 구분: Hello ← hel', () => {
    const r = compare('Hello', 'hel');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.index).toBe(0);
    expect(r.errorKey!.expected).toMatchObject({ code: 'KeyH', shift: true });
    expect(r.wrongLang).toBe(false);
  });
  it('영문 오타 위치', () => {
    const r = compare('apple', 'apl');
    expect(r.errorKey!.index).toBe(2);
    expect(r.chars).toEqual(['ok', 'ok', 'error']);
    expect(r.targetStates).toEqual(['done', 'done', 'error', 'todo', 'todo']);
  });
  it('기호: ? 자리에 /', () => {
    const r = compare('왜?', '왜/');
    expect(r.ok).toBe(false);
    expect(r.errorKey!.expected).toMatchObject({ code: 'Slash', shift: true });
  });
  it('줄바꿈 목표', () => {
    expect(compare('가\n나', '가\n').ok).toBe(true);
    expect(compare('가\n나', '가\n').next!.code).toBe('KeyS');
  });
  it('totalKeys', () => {
    expect(compare('Hello!', '').totalKeys).toBe(8);
  });
});

describe('compare: wrongLang', () => {
  it.each([
    ['나라', 's', true],
    ['나라', 'skfk', true],
    ['나라', '나f', true],
    ['apple', 'ㅁ', true],
    ['apple', 'apㅔ', true],
    ['나라', '너', false],
    ['abc', 'abd', false],
    ['나라', '나1', false],
    ['A1', '1', false],
    ['DNA 구조', 'DNA r', true],
  ])('%j ← %j : %s', (t, i, v) => {
    expect(compare(t, i).wrongLang).toBe(v);
  });
});

describe('compare: 화면 상태', () => {
  it('조합 중 추정: 가나 ← 간', () => {
    const r = compare('가나', '간');
    expect(r.chars).toEqual(['composing']);
    expect(r.targetStates).toEqual(['done', 'current']);
  });
  it('목표와 같은 마지막 글자는 ok: 가나 ← 가', () => {
    const r = compare('가나', '가');
    expect(r.chars).toEqual(['ok']);
    expect(r.targetStates).toEqual(['done', 'current']);
  });
  it('조합 중 직접 지정', () => {
    expect(compare('가나', '가', { composing: true }).chars).toEqual(['composing']);
    expect(compare('가나', '간', { composing: false }).chars).toEqual(['ok']);
  });
  it('받침 전 단계는 current: 각 ← 가', () => {
    expect(compare('각', '가').targetStates).toEqual(['current']);
  });
  it('빈 입력', () => {
    const r = compare('가나', '');
    expect(r.ok).toBe(true);
    expect(r.done).toBe(false);
    expect(r.chars).toEqual([]);
    expect(r.targetStates).toEqual(['current', 'todo']);
    expect(r.next!.code).toBe('KeyR');
    expect(r.matchedKeys).toBe(0);
  });
  it('완료면 next null, 모두 done', () => {
    const r = compare('가나', '가나');
    expect(r.next).toBeNull();
    expect(r.targetStates).toEqual(['done', 'done']);
  });
  it('next: 가나 ← 가 → ㄴ(KeyS)', () => {
    expect(compare('가나', '가').next).toMatchObject({ code: 'KeyS', shift: false, label: 'ㄴ' });
  });
  it('next: 쌍자음은 shift', () => {
    expect(compare('아빠', '아').next).toMatchObject({ code: 'KeyQ', shift: true });
  });
  it('영문 마지막 글자는 composing 이 아니다', () => {
    expect(compare('abc', 'ab').chars).toEqual(['ok', 'ok']);
  });
  it('NFD 목표와 NFC 입력', () => {
    expect(compare('가나'.normalize('NFD'), '가나').done).toBe(true);
    expect(compare('가나', '가나'.normalize('NFD')).done).toBe(true);
  });
  it('matchedUnits', () => {
    expect(compare('가나', '간').matchedUnits).toBe(3);
  });
});

describe('TypingMeter 오타 집계', () => {
  function run(m: TypingMeter, target: string, steps: string[], t0 = 0, dt = 100) {
    steps.forEach((s, i) => m.update(target, s, t0 + i * dt));
  }
  it('도깨비불 과정은 오타 0, 정타 4', () => {
    const m = new TypingMeter();
    run(m, '가나', ['ㄱ', '가', '간', '가나']);
    const s = m.snapshot(10000);
    expect(s.strokes).toBe(4);
    expect(s.typos).toBe(0);
  });
  it('벗어나는 순간 1회, 계속 쳐도 추가 없음, 고친 뒤 다시 틀리면 1회 더', () => {
    const m = new TypingMeter();
    run(m, '가나다', ['ㄱ', '가', '갇', '가다', '가ㄷ', '가', '갇', '간', '가나', '가낟', '가나다']);
    const s = m.snapshot(10000);
    expect(s.typos).toBe(2);
    expect(s.strokes).toBe(6);
    expect(s.missKeys).toEqual({ KeyS: 2 });
  });
  it('지웠다 다시 친 글쇠는 중복 계산하지 않는다', () => {
    const m = new TypingMeter();
    run(m, '가나', ['ㄱ', '가', 'ㄱ', '', 'ㄱ', '가', '간', '가나']);
    expect(m.snapshot(10000).strokes).toBe(4);
  });
  it('한/영 상태 틀림은 오타로 세지 않는다', () => {
    const m = new TypingMeter();
    run(m, '나라', ['s', 'sk', 's', '', 'ㄴ', '나', '날', '나라']);
    const s = m.snapshot(10000);
    expect(s.typos).toBe(0);
    expect(s.strokes).toBe(4);
  });
  it('Shift 조합은 2타', () => {
    const m = new TypingMeter();
    run(m, '까', ['ㄲ', '까']);
    expect(m.snapshot(10000).strokes).toBe(3);
  });
  it('commit 으로 다음 항목에 넘어가도 누적', () => {
    const m = new TypingMeter();
    run(m, '가', ['ㄱ', '가']);
    m.commit('가');
    run(m, '나', ['ㄴ', '너'], 1000);
    m.commit('나');
    const s = m.snapshot(10000);
    expect(s.strokes).toBe(3);
    expect(s.typos).toBe(1);
    expect(s.items).toBe(2);
  });
  it('commit 없이 목표가 바뀌면 자동으로 이전 항목을 마친다', () => {
    const m = new TypingMeter();
    run(m, '가', ['ㄱ', '가']);
    run(m, '나', ['ㄴ', '나'], 500);
    expect(m.snapshot(10000).strokes).toBe(4);
  });
  it('같은 자리 오타가 다른 입력으로 바뀌어도 1회', () => {
    const m = new TypingMeter();
    run(m, 'abc', ['a', 'ax', 'a', 'ay']);
    expect(m.snapshot(10000).typos).toBe(2);
    const m2 = new TypingMeter();
    run(m2, 'abc', ['a', 'ax', 'axy', 'axyz']);
    expect(m2.snapshot(10000).typos).toBe(1);
  });
  it('입력이 목표보다 길어지면 오타 1회(목표 글쇠 없음)', () => {
    const m = new TypingMeter();
    run(m, 'ab', ['a', 'ab', 'abc']);
    const s = m.snapshot(10000);
    expect(s.typos).toBe(1);
    expect(s.missKeys).toEqual({});
  });
  it('addStrokes / addTypo 직접 가산', () => {
    const m = new TypingMeter();
    m.addStrokes(9, 0);
    m.addTypo('KeyA', 100);
    m.addTypo('KeyA');
    m.addTypo();
    const s = m.snapshot(60000);
    expect(s.strokes).toBe(9);
    expect(s.typos).toBe(3);
    expect(s.missKeys).toEqual({ KeyA: 2 });
    expect(s.accuracy).toBe(75);
  });
});

describe('TypingMeter 시간·타수·정확도', () => {
  it('첫 입력부터 측정, 3초 미만이면 kpm 0', () => {
    const m = new TypingMeter();
    m.update('가나', 'ㄱ', 1000);
    m.update('가나', '가나', 2000);
    expect(m.snapshot(3999).kpm).toBe(0);
    expect(m.snapshot(4000).kpm).toBe(80);
  });
  it('100타를 60초에 → 100타/분', () => {
    const m = new TypingMeter();
    m.addStrokes(100, 0);
    expect(m.snapshot(60000).kpm).toBe(100);
    expect(m.snapshot(60000).seconds).toBe(60);
  });
  it('일시정지 구간은 빠진다', () => {
    const m = new TypingMeter();
    m.addStrokes(100, 0);
    m.pause(30000);
    expect(m.paused).toBe(true);
    m.resume(90000);
    expect(m.snapshot(120000).seconds).toBe(60);
    expect(m.snapshot(120000).kpm).toBe(100);
  });
  it('일시정지 중 입력하면 자동 재개', () => {
    const m = new TypingMeter();
    m.update('가나', 'ㄱ', 0);
    m.pause(10000);
    m.update('가나', '가', 50000);
    expect(m.paused).toBe(false);
    expect(m.elapsedMs(60000)).toBe(20000);
  });
  it('시작 전 pause/resume 은 무시', () => {
    const m = new TypingMeter();
    m.pause(100);
    m.resume(200);
    expect(m.started).toBe(false);
    expect(m.snapshot(5000).seconds).toBe(0);
  });
  it('빈 입력만으로는 시작하지 않는다', () => {
    const m = new TypingMeter();
    m.update('가', '', 0);
    expect(m.started).toBe(false);
  });
  it('정확도는 소수 첫째 자리', () => {
    const m = new TypingMeter();
    m.addStrokes(2, 0);
    m.addTypo('KeyA');
    expect(m.snapshot(1000).accuracy).toBe(66.7);
  });
  it('아무것도 안 쳤으면 정확도 0', () => {
    expect(new TypingMeter().snapshot(0).accuracy).toBe(0);
  });
  it('combo / maxCombo', () => {
    const m = new TypingMeter();
    m.addStrokes(5, 0);
    m.addTypo('KeyA');
    m.addStrokes(3, 100);
    const s = m.snapshot(1000);
    expect(s.combo).toBe(3);
    expect(s.maxCombo).toBe(5);
  });
  it('update 의 정타도 combo 에 쌓이고 오타에서 끊긴다', () => {
    const m = new TypingMeter();
    m.update('가나다', '가', 0);
    m.update('가나다', '간', 100);
    m.update('가나다', '가낙', 200);
    const s = m.snapshot(1000);
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(4);
  });
  it('1500타/분 초과면 isSuspicious', () => {
    const m = new TypingMeter();
    m.addStrokes(100, 0);
    expect(m.isSuspicious(2000)).toBe(true);
    expect(m.isSuspicious(60000)).toBe(false);
  });
  it('20ms 미만 간격 10회 연속이면 isSuspicious', () => {
    const m = new TypingMeter();
    const text = 'abcdefghijklmnop';
    for (let i = 1; i <= 12; i++) m.update(text, text.slice(0, i), i * 10);
    expect(m.isSuspicious(600000)).toBe(true);
  });
  it('보통 속도는 의심하지 않는다', () => {
    const m = new TypingMeter();
    const text = 'abcdefghijklmnop';
    for (let i = 1; i <= 16; i++) m.update(text, text.slice(0, i), i * 200);
    expect(m.isSuspicious(4000)).toBe(false);
  });
  it('lastInputAt', () => {
    const m = new TypingMeter();
    m.update('a', 'a', 1234);
    expect(m.lastInputAt).toBe(1234);
  });
});

describe('splitLines', () => {
  it('짧은 글은 한 줄', () => {
    expect(splitLines('가나 다라')).toEqual(['가나 다라']);
  });
  it('어절 단위로 maxLen 이하', () => {
    const text = '하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열';
    const lines = splitLines(text, 10);
    expect(lines.every((l) => Array.from(l).length <= 10)).toBe(true);
    expect(lines.join(' ')).toBe(text);
  });
  it('줄 끝·처음에 공백 없음', () => {
    for (const l of splitLines('  가나   다라  마바  ', 5)) expect(l).toBe(l.trim());
  });
  it('기존 줄바꿈은 줄을 나눈다', () => {
    expect(splitLines('가나\n다라')).toEqual(['가나', '다라']);
  });
  it('너무 긴 어절은 잘린다', () => {
    expect(splitLines('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('기본 38자', () => {
    const text = Array(30).fill('낱말').join(' ');
    const lines = splitLines(text);
    expect(lines.every((l) => Array.from(l).length <= 38)).toBe(true);
    expect(lines[0].length).toBeGreaterThan(30);
  });
  it('빈 글', () => {
    expect(splitLines('')).toEqual([]);
  });
});
