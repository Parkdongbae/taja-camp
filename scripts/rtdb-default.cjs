// firebase CLI 에 명령이 없는 두 가지를 CLI 내부 함수를 빌려 처리한다.
//   실행: npx -y -p firebase-tools@latest node scripts/rtdb-default.cjs <프로젝트ID> <위치>
//   하는 일: ① 필요한 API 켜기(Firestore·Realtime Database·로그인) ② Realtime Database 기본 인스턴스 만들기
//   출력: API 를 켠 뒤 APIS_OK, 마지막 줄에 EXISTS 또는 CREATED. 실패하면 종료 코드 1.
// CLI 내부 구조가 바뀌면 동작하지 않을 수 있으므로, setup.mjs 는 실패하면 다른 방법(gcloud·직접 만들기)으로 넘어간다.
const fs = require('node:fs');
const path = require('node:path');

const [project, location = 'asia-southeast1'] = process.argv.slice(2);
if (!project) {
  console.error('프로젝트 ID 가 필요합니다');
  process.exit(1);
}

// npx 가 PATH 맨 앞에 넣어 준 node_modules/.bin 옆에서 firebase-tools 를 찾는다(전역 설치도 함께 찾는다)
const dirs = (process.env.PATH || '').split(path.delimiter).flatMap((p) => [path.join(p, '..', 'firebase-tools'), path.join(p, 'node_modules', 'firebase-tools')]);
const root = dirs.find((d) => fs.existsSync(path.join(d, 'lib', 'management', 'database.js')));
if (!root) {
  console.error('firebase-tools 를 찾지 못했습니다');
  process.exit(1);
}
const lib = (m) => require(path.join(root, 'lib', m));

(async () => {
  const { requireAuth } = lib('requireAuth');
  const db = lib('management/database');
  const name = `${project}-default-rtdb`;
  // CLI 가 명령을 실행하기 전에 하는 것처럼 로그인한 계정을 먼저 고른다(없으면 환경의 기본 인증을 쓴다)
  const options = { project };
  try {
    const auth = lib('auth');
    const account = auth.selectAccount(undefined, process.cwd());
    if (account) auth.setActiveAccount(options, account);
  } catch {
    // 계정을 못 골라도 requireAuth 가 기본 인증을 시도한다
  }
  await requireAuth(options);
  const { ensure } = lib('ensureApiEnabled');
  let apis = true;
  for (const [host, label] of [
    ['firestore.googleapis.com', 'firestore'],
    ['identitytoolkit.googleapis.com', 'auth'],
    ['firebasedatabase.googleapis.com', 'database'],
  ]) {
    try {
      await ensure(project, host, label, true);
    } catch (e) {
      apis = false;
      console.error(`API 를 켜지 못함(${host}): ${e?.message ?? e}`);
    }
  }
  if (apis) console.log('APIS_OK');
  try {
    await db.getDatabaseInstanceDetails(project, name);
    console.log('EXISTS');
    return;
  } catch {
    // 없으면 만든다
  }
  await db.createInstance(project, name, location, db.DatabaseInstanceType.DEFAULT_DATABASE);
  console.log('CREATED');
})().catch((e) => {
  console.error(e?.message ?? String(e));
  process.exit(1);
});
