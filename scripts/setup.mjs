#!/usr/bin/env node
// 우리 학교용 타자 훈련소를 한 번에 설치한다(구글 계정만 있으면 됨, 무료 요금제).
//   실행: npm run setup            (Google Cloud Shell 권장. docs/SETUP.md 참고)
//   옵션: --project <ID>  이미 만든 Firebase 프로젝트에 설치
//         --location <Firestore 위치, 기본 asia-northeast3>      --rtdb <RTDB 위치, 기본 asia-southeast1>
//         --skip-build  빌드 생략(이미 dist 가 있을 때)          --yes  묻지 않고 진행
// 하는 일: ① 로그인 확인 ② Firebase 프로젝트 만들기 ③ 웹 앱 등록 ④ API 켜기, Realtime Database·Firestore 만들기(scripts/rtdb-default.cjs)
//          ⑤ .env 쓰기 ⑥ 빌드 ⑦ 로그인 방식(익명·이메일)·보안 규칙·사이트 배포 → https://<ID>.web.app
// 다시 실행하면 .setup-state.json 에 적힌 프로젝트로 이어서(또는 새 버전으로 다시) 배포한다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.setup-state.json');
const WIN = process.platform === 'win32';
const NPX = WIN ? 'npx.cmd' : 'npx';
const NPM = WIN ? 'npm.cmd' : 'npm';
const FB = ['-y', 'firebase-tools@latest'];
const WEB_APP_NAME = 'Default Web App'; // firebase deploy --only auth 가 찾는 이름

// ── 인자 ──
export function parseArgs(argv) {
  const out = { yes: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--skip-build') out.skipBuild = true;
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--location') out.location = argv[++i];
    else if (a === '--rtdb') out.rtdb = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/** 프로젝트 ID: 소문자·숫자·하이픈, 6~30자, 글자로 시작 */
export function validProjectId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id);
}
export function newProjectId() {
  return `taja-${randomBytes(4).toString('hex')}`;
}

/** firebase --json 출력에서 JSON 부분만 꺼낸다(앞에 진행 표시가 섞일 수 있다) */
export function parseJsonOutput(text) {
  const i = text.indexOf('{');
  if (i < 0) throw new Error('JSON 출력이 없습니다');
  return JSON.parse(text.slice(i));
}

export function rtdbUrl(projectId, location) {
  const name = `${projectId}-default-rtdb`;
  return location === 'us-central1' ? `https://${name}.firebaseio.com` : `https://${name}.${location}.firebasedatabase.app`;
}

export function envText(cfg) {
  return [
    '# scripts/setup.mjs 가 만든 파일입니다. (Firebase 웹 앱 설정값: 공개돼도 되는 값이며 보안은 규칙으로 지킵니다)',
    `VITE_FIREBASE_API_KEY=${cfg.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${cfg.authDomain}`,
    `VITE_FIREBASE_PROJECT_ID=${cfg.projectId}`,
    `VITE_FIREBASE_DATABASE_URL=${cfg.databaseURL}`,
    `VITE_FIREBASE_APP_ID=${cfg.appId}`,
    '',
  ].join('\n');
}

// ── 실행 도우미 ──
const say = (s) => console.log(s);
const step = (n, s) => say(`\n[${n}/7] ${s}`);
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

/** 명령 실행. 윈도우는 .cmd 를 셸로 실행해야 해서 인자를 따옴표로 감싼다 */
function sp(cmd, args, opts = {}) {
  const a = WIN ? args.map((x) => (/[\s()&|<>^"]/.test(x) ? `"${x.replace(/"/g, '')}"` : x)) : args;
  return spawnSync(cmd, a, { cwd: ROOT, shell: WIN, ...opts });
}
/** firebase 명령을 --json 으로 실행해 result 를 돌려준다. 실패하면 { error } */
function fbJson(args) {
  const r = sp(NPX, [...FB, ...args, '--json'], { encoding: 'utf8' });
  try {
    const j = parseJsonOutput(r.stdout || '');
    if (j.status === 'success') return { result: j.result };
    return { error: j.error?.message || j.error || '알 수 없는 오류' };
  } catch {
    return { error: (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ') || '실행하지 못했습니다' };
  }
}
/** 화면에 그대로 보여 주며 실행. 성공하면 true */
function runShow(cmd, args) {
  return sp(cmd, args, { stdio: 'inherit' }).status === 0;
}
function gcloudToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: WIN }).trim() || null;
  } catch {
    return null;
  }
}
const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
};
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''));
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def = '') => (args.yes ? def : (await rl.question(q)).trim() || def);
  const state = readState();
  const location = args.location || state.location || 'asia-northeast3';
  const rtdb = args.rtdb || state.rtdb || 'asia-southeast1';

  say('══════════════════════════════════════════');
  say(' ⌨  타자 훈련소 · 우리 학교용 설치');
  say('══════════════════════════════════════════');
  say('구글 계정으로 무료(Spark) Firebase 프로젝트를 만들고 사이트까지 올립니다. 5~10분쯤 걸려요.');

  // ① 로그인
  step(1, '구글 계정 확인');
  let list = fbJson(['projects:list']);
  if (list.error) {
    say('로그인이 필요합니다. 아래에 나오는 주소를 열어 구글 계정으로 허용한 뒤, 받은 코드를 붙여 넣으세요.');
    if (!runShow(NPX, [...FB, 'login', '--no-localhost'])) fail('로그인하지 못했습니다. 다시 실행해 주세요.');
    list = fbJson(['projects:list']);
    if (list.error) fail(`프로젝트 목록을 읽지 못했습니다: ${list.error}`);
  }
  say('✔ 로그인 확인');

  // ② 프로젝트
  step(2, 'Firebase 프로젝트');
  let projectId = args.project || state.projectId;
  const exists = (id) => (list.result || []).some((p) => p.projectId === id);
  if (projectId && !validProjectId(projectId)) fail(`프로젝트 ID 형식이 맞지 않습니다: ${projectId}`);
  if (projectId && exists(projectId)) say(`✔ 기존 프로젝트를 씁니다: ${projectId}`);
  else {
    projectId = projectId || newProjectId();
    say(`프로젝트를 만듭니다: ${projectId} (1~2분)`);
    // 표시 이름은 영문·숫자만(구글 클라우드 이름 규칙). 콘솔에서 나중에 바꿀 수 있다
    if (!runShow(NPX, [...FB, 'projects:create', projectId, '--display-name', `Taja Camp ${projectId.slice(-4)}`])) {
      fail(
        [
          '프로젝트를 만들지 못했습니다. 흔한 원인:',
          '  · Firebase 를 처음 쓰는 계정 → https://console.firebase.google.com 을 한 번 열어 약관에 동의한 뒤 다시 실행',
          '  · 학교(Workspace) 계정에서 프로젝트 만들기가 막혀 있음 → 개인 구글 계정으로 실행',
          '  · 프로젝트 개수 한도 초과 → 안 쓰는 프로젝트를 지우거나 --project <기존 ID> 로 실행',
        ].join('\n'),
      );
    }
  }
  Object.assign(state, { projectId, location, rtdb });
  saveState(state);
  const P = ['--project', projectId];

  // ③ 웹 앱
  step(3, '웹 앱 등록');
  let apps = fbJson(['apps:list', 'WEB', ...P]);
  let app = (apps.result || []).find((a) => a.displayName === WEB_APP_NAME) || (apps.result || [])[0];
  if (!app) {
    const made = fbJson(['apps:create', 'WEB', WEB_APP_NAME, ...P]);
    if (made.error) fail(`웹 앱을 만들지 못했습니다: ${made.error}`);
    apps = fbJson(['apps:list', 'WEB', ...P]);
    app = (apps.result || [])[0];
  }
  if (!app?.appId) fail('웹 앱 정보를 읽지 못했습니다. 잠시 뒤 다시 실행해 주세요.');
  say(`✔ 웹 앱: ${app.appId}`);

  // ④ 데이터베이스
  step(4, '데이터베이스 만들기');
  const token = gcloudToken();
  if (token) {
    // 필요한 API 켜기(이미 켜져 있으면 그대로)
    sp('gcloud', ['services', 'enable', 'firestore.googleapis.com', 'firebasedatabase.googleapis.com', 'identitytoolkit.googleapis.com', '--project', projectId, '--quiet'], {
      stdio: 'ignore',
    });
  }
  // Realtime Database 기본 인스턴스: CLI 명령이 없어 ① CLI 내부 함수 ② gcloud 토큰 + 관리 API ③ 직접 만들기 순서로 시도
  const inst = `${projectId}-default-rtdb`;
  let rtdbOk = false;
  {
    // 1순위: firebase CLI 의 로그인으로 만든다(gcloud 가 없어도 됨)
    const r = sp(NPX, ['-y', '-p', 'firebase-tools@latest', 'node', join('scripts', 'rtdb-default.cjs'), projectId, rtdb], { encoding: 'utf8' });
    rtdbOk = r.status === 0 && /EXISTS|CREATED/.test(r.stdout || '');
    if (!rtdbOk) say(`  (CLI 로 만들지 못함: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0] || '알 수 없음'})`);
  }
  if (!rtdbOk && token) {
    const api = 'https://firebasedatabase.googleapis.com/v1beta';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': projectId };
    try {
      const got = await fetch(`${api}/projects/${projectId}/locations/-/instances/${inst}`, { headers });
      if (got.ok) rtdbOk = true;
      else {
        const made = await fetch(`${api}/projects/${projectId}/locations/${rtdb}/instances?databaseId=${inst}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: 'DEFAULT_DATABASE' }),
        });
        rtdbOk = made.ok || made.status === 409;
        if (!rtdbOk) say(`  (자동 생성 실패: ${made.status} ${(await made.text()).slice(0, 200)})`);
      }
    } catch (e) {
      say(`  (자동 생성 실패: ${e?.message ?? e})`);
    }
  }
  if (rtdbOk) say(`✔ Realtime Database (${rtdb})`);
  else {
    say('Realtime Database 는 직접 한 번 만들어 주세요(1분):');
    say(`  1) https://console.firebase.google.com/project/${projectId}/database 를 연다`);
    say(`  2) [데이터베이스 만들기] → 위치 "싱가포르(asia-southeast1)" → "잠금 모드로 시작" → [사용 설정]`);
    await ask('  만들었으면 Enter 를 누르세요... ');
  }

  // Firestore: API 를 막 켠 직후에는 잠시 거절될 수 있어 몇 번 다시 시도한다
  let fsDone = false;
  let fsOut = '';
  for (let i = 0; i < 8 && !fsDone; i++) {
    if (i) {
      say('  Firestore 준비를 기다리는 중...');
      await new Promise((r) => setTimeout(r, 15000));
    }
    const fs = sp(NPX, [...FB, 'firestore:databases:create', '(default)', '--location', location, ...P], { encoding: 'utf8' });
    fsOut = `${fs.stdout}${fs.stderr}`;
    if (fs.status === 0) {
      say(`✔ Firestore (${location})`);
      fsDone = true;
    } else if (/already exists|ALREADY_EXISTS|409/i.test(fsOut)) {
      say('✔ Firestore (이미 있음)');
      fsDone = true;
    } else if (!/has not been used|is disabled|403|PERMISSION_DENIED|503|UNAVAILABLE/i.test(fsOut)) break;
  }
  if (!fsDone) fail(`Firestore 를 만들지 못했습니다. 몇 분 뒤 npm run setup 을 다시 실행해 주세요.\n${fsOut.trim().split('\n').slice(-4).join('\n')}`);

  // ⑤ .env
  step(5, '설정 파일(.env) 쓰기');
  const sdk = fbJson(['apps:sdkconfig', 'WEB', app.appId, ...P]);
  if (sdk.error) fail(`웹 앱 설정값을 읽지 못했습니다: ${sdk.error}`);
  const c = sdk.result?.sdkConfig || sdk.result || {};
  const cfg = {
    apiKey: c.apiKey,
    authDomain: c.authDomain || `${projectId}.firebaseapp.com`,
    projectId,
    databaseURL: c.databaseURL || rtdbUrl(projectId, rtdb),
    appId: c.appId || app.appId,
  };
  if (!cfg.apiKey) fail('API 키를 읽지 못했습니다. 잠시 뒤 다시 실행해 주세요.');
  writeFileSync(join(ROOT, '.env'), envText(cfg));
  say('✔ .env');

  // ⑥ 빌드
  step(6, '사이트 빌드');
  if (!args.skipBuild) {
    if (!existsSync(join(ROOT, 'node_modules')) && !runShow(NPM, ['install', '--no-audit', '--no-fund'])) fail('패키지를 설치하지 못했습니다.');
    if (!runShow(NPM, ['run', 'build'])) fail('빌드하지 못했습니다.');
  }
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/index.html 이 없습니다. --skip-build 를 빼고 다시 실행해 주세요.');
  say('✔ 빌드');

  // ⑦ 배포: 로그인 방식(익명·이메일/비밀번호), 보안 규칙, 사이트
  step(7, '배포(로그인 방식·보안 규칙·사이트)');
  let ok = runShow(NPX, [...FB, 'deploy', '--only', 'auth,firestore,database,hosting', ...P, '--non-interactive']);
  if (!ok) {
    say('\n한꺼번에 배포하지 못해 하나씩 다시 시도합니다...');
    const parts = ['auth', 'firestore', 'database', 'hosting'].map((t) => [t, runShow(NPX, [...FB, 'deploy', '--only', t, ...P, '--non-interactive'])]);
    const bad = parts.filter(([, v]) => !v).map(([t]) => t);
    ok = bad.length === 0;
    if (!ok) {
      if (bad.includes('auth')) {
        say(`\n로그인 방식을 직접 켜 주세요: https://console.firebase.google.com/project/${projectId}/authentication/providers`);
        say('  [시작하기] → "익명" 사용 설정, "이메일/비밀번호" 사용 설정');
      }
      fail(`배포하지 못한 항목: ${bad.join(', ')}. 위 안내를 따른 뒤 npm run setup 을 다시 실행하면 이어서 진행합니다.`);
    }
  }
  state.url = `https://${projectId}.web.app`;
  state.deployedAt = new Date().toISOString();
  saveState(state);
  rl.close();

  say('\n══════════════════════════════════════════');
  say(' 🎉 설치가 끝났습니다!');
  say('══════════════════════════════════════════');
  say(` 사이트 주소: ${state.url}`);
  say(' 다음 할 일:');
  say('  1) 사이트를 열고 아래쪽 [선생님 모드] → [처음이면 교사 계정 만들기]');
  say('     가장 먼저 가입한 계정이 관리자가 됩니다(다른 선생님은 관리자가 초대).');
  say('  2) [학생 관리]에서 학번·이름을 등록 → 학생은 첫 접속 때 PIN 을 직접 정합니다.');
  say(' 새 버전으로 올릴 때: git pull && npm run setup');
  say(` Firebase 콘솔: https://console.firebase.google.com/project/${projectId}`);
}

// 직접 실행했을 때만 동작(테스트에서 import 해도 실행되지 않게)
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((e) => fail(e?.message ?? String(e)));
}
