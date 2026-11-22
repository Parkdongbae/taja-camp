// 배틀 입력의 욕설·비속어 거르기. 순수 로직.
//   squash(text): 띄어쓰기·숫자·기호를 지운 비교용 문자열
//   findBadWord(text, extra?: string[]): string | null   걸린 낱말(없으면 null). extra 는 선생님이 추가한 낱말
//   BAD_WORD_COUNT: 기본 목록 낱말 수
// 띄어쓰기·숫자·기호를 섞은 경우("시 1 발", "씨.발")와 영어 글자를 늘여 쓴 경우(fuuuck)도 잡는다.

// 비속어 (띄어쓰기 없이, 소문자로 적기)
const WORDS: string[] = [
    // 욕설
    '시발', '씨발', '씨빨', '씨팔', '시팔', '시펄', '씨펄', '쓰발', '쓰벌', '씌발', '시벌', '씨벌', '슈발', '쉬발', '싀발', 'ㅆ발', 'ㅅ발', '시이발', '씨이발', '씨바알', '십발', '십팔놈', '십팔년', '씨부랄', '씨부럴', '시부랄', '시부럴',
    '씹새', '씹년', '씹놈', '씹할', '씹창', '씹물', '씹질', '십새', '쌉새', '썅', '쌍년', '쌍놈', '쌍노무', '상놈의',
    '병신', '븅신', '빙신', '병쉰', '병싄', '뷰웅신', '븽신', '등신', '머저리', '찐따', '또라이', '돌아이',
    '좆', '좃', '좇같', 'ㅈ같', '존나', '존니', '존내', '졸라', '졸래', '조낸', '좆나', '좆까', '좃까', '좆밥', '좆같', '좃같', '존맛탱',
    '개새끼', '개색기', '개색끼', '개쌔끼', '개쉐끼', '개세끼', '개새기', '개섀끼', '개쉑', '개색휘', '개시키', '개자식', '개놈', '개년', '개같', '개소리', '개지랄', '개빡', '개좆', '개씹',
    '새끼야', '새꺄', '쉐끼', '쌔끼', '느금', '느개비', '니애미', '니애비', '니미', '니엄창', '엠창', '엠생', '애미뒤', '애비뒤', '애미없', '애비없', '부모없', '호로자식', '호로새', '후레자식', '후레새',
    '지랄', '염병', '옘병', '엿먹', '엿이나', '뒈져', '뒤져라', '뒤지고싶', '죽여버', '죽일놈', '죽을래', '꺼지세요', '꺼져라', '닥쳐', '닥치라', '닥치세', '아가리',
    '미친놈', '미친년', '미친새', '미친것', '미친개', '미친색', '미친쉐', '미쳤냐', '정신병자', '저능아', '빡대가리', '돌대가리', '대가리깨', '골빈',
    '한남충', '김치녀', '맘충', '급식충', '틀딱', '꼴페미', '페미년', '일베충', '메갈년', '짱깨', '쪽바리', '깜둥이',
    '창녀', '창놈', '걸레년', '화냥', '갈보', '섹스', '야동', '딸딸이', '자위', '보지털', '자지털', '보짓', '자짓', '젖꼭지', '빠구리', '떡치', '강간', '성폭행',
    // 초성·자모로 쓴 욕
    'ㅅㅂ', 'ㅆㅂ', 'ㅅㅃ', 'ㅆㅃ', 'ㅂㅅ', 'ㅄ', 'ㅂㅆ', 'ㅈㄹ', 'ㅈㄴ', 'ㅈ까', 'ㄱㅅㄲ', 'ㅅㄲ', 'ㅆㄹㄱ', 'ㄷㅊ', 'ㄲㅈ', 'ㅁㅊ', 'ㅗㅗ', 'ㅅㅍ', 'ㅆㅍ', 'ㄴㄱㅁ', 'ㅈㄲ',
    // 영어
    'fuck', 'fuk', 'fck', 'fxck', 'phuck', 'shit', 'bitch', 'biatch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt', 'motherf', 'mofo', 'wtf', 'stfu', 'gtfo', 'nigg', 'retard', 'slut', 'whore', 'porn', 'sex', 'jerkoff', 'dumbass', 'jackass',
    // 손가락 욕 이모지
    String.fromCodePoint(0x1F595)
];
// 비속어처럼 보이지만 정상인 말 (먼저 지운 뒤 검사)
const ALLOW: string[] = [
    '시발점', '시발역', '시발택시', '시발자동차', '수박씨발라', '참외씨발라', '호박씨발라', '해바라기씨발라', '씨발라먹',
    '등신대', '등신불', '병신춤', '십팔번', '미친듯이', '미친듯', '자위대', '자위권', '정당방위', '강간죄', '전염병',
    'sussex', 'essex', 'middlesex', 'sextet', 'dickens', 'dickinson'
];

// 보이지 않는 글자 (폭 없는 공백 등)
const INVISIBLE = new RegExp('[' + [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join('') + ']', 'g');
const FINGER = String.fromCodePoint(0x1f595);

/** 띄어쓰기·숫자·기호 제거 (한글, 한글 자모, 영어, 손가락 이모지만 남김) */
export function squash(s: string): string {
  let t = String(s ?? '').toLowerCase().normalize('NFC').replace(INVISIBLE, '');
  const keepFinger = t.includes(FINGER);
  t = t.replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  return keepFinger ? t + FINGER : t;
}

const uniq = (a: string[]) => [...new Set(a.map(squash).filter(Boolean))];
const BASE = uniq(WORDS);
const ALLOWED = uniq(ALLOW).sort((a, b) => b.length - a.length);
// 영어 낱말은 글자를 늘여 쓴 것도 잡는다: fuck → f+u+c+k+ (겹글자는 그 수만큼 있어야 함: nigg 는 night 에 안 걸림)
const stretch = (w: string): RegExp | null => (/^[a-z]+$/.test(w) ? new RegExp(w.split('').map((c) => c + '+').join('')) : null);
const BASE_RE = BASE.map(stretch);

export const BAD_WORD_COUNT = BASE.length;

export function findBadWord(text: string, extra?: readonly string[]): string | null {
  let t = squash(text);
  if (!t) return null;
  for (const a of ALLOWED) t = t.split(a).join('_');
  for (let i = 0; i < BASE.length; i++) {
    const re = BASE_RE[i];
    if (re ? re.test(t) : t.includes(BASE[i])) return BASE[i];
  }
  if (extra && extra.length) {
    for (const w of uniq([...extra])) {
      const re = stretch(w);
      if (re ? re.test(t) : t.includes(w)) return w;
    }
  }
  return null;
}
