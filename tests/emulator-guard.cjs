// 에뮬레이터 통합 검사 전용 안전장치. 어떤 Firebase·Google SDK 보다 먼저 require 한다(늦으면 멈춘다).
// 1) 환경: 고정할 값(127.0.0.1:8080, demo-minb)과 다른 값이 이미 있으면 덮어쓰지 않고 멈춘다.
//    사용자 기본 자격증명(GOOGLE_APPLICATION_CREDENTIALS 등)이 설정돼 있어도 멈춘다.
// 2) 이 Node 프로세스의 net·tls·http2·fetch 연결은 정확히 127.0.0.1:8080 만 허용한다
//    (Unix 소켓, 다른 loopback 포트, 외부 호스트, 메타데이터 서버 모두 거부). DNS 조회와 UDP 는 전부 막는다.
// 3) ADC·gcloud 설정·.env 파일은 경로만 보고 열기 전에 막는다.
// 한계: child_process·worker·네이티브 애드온이 직접 여는 연결은 막지 못한다(이 검사는 그 경로를 쓰지 않는다).
// 프로세스 전체 격리를 보장하는 것은 아니다.
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const http2 = require('node:http2');
const dns = require('node:dns');
const dgram = require('node:dgram');

const HOST = '127.0.0.1', PORT = 8080;
const EMULATOR = `${HOST}:${PORT}`;
const PROJECT = 'demo-minb';

const early = Object.keys(require.cache).filter(k => /[\\/](firebase|firebase-admin|@firebase|@google-cloud|@grpc|google-auth-library|gcp-metadata)[\\/]/.test(k));
if (early.length) throw new Error(`안전장치보다 먼저 SDK 가 로드됐습니다. 멈춥니다: ${early[0]}`);

// ── 환경: 고정 값과 다른 기존 값이 있으면 멈춘다 ──
const expected = { FIRESTORE_EMULATOR_HOST: EMULATOR, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT };
for (const [key, value] of Object.entries(expected)) {
  if (process.env[key] !== undefined && process.env[key] !== value) throw new Error(`${key} 가 이미 다른 값입니다. 멈춥니다.`);
}
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'CLOUDSDK_CONFIG']) {
  if (process.env[key] !== undefined) throw new Error(`${key} 가 설정돼 있습니다. 비운 환경에서 다시 실행하세요.`);
}
Object.assign(process.env, expected);

// ── 연결 허용 목록 ──
function allow(host, port, what) {
  const h = String(host == null ? 'localhost' : host).replace(/^\[|\]$/g, '');
  if (h !== HOST || Number(port) !== PORT) throw new Error(`허용하지 않은 연결을 막았습니다(${what}): ${h}:${port}`);
}
function socketTarget(args) {
  const a = Array.isArray(args[0]) ? args[0] : args; // Node 내부는 [options, cb] 배열로 부른다
  const first = a[0];
  if (first && typeof first === 'object') return first;
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first };
  return { port: first, host: typeof a[1] === 'string' ? a[1] : undefined };
}
function checkSocket(target, what) {
  if (target.path) throw new Error(`Unix 소켓 연결을 막았습니다(${what}): ${target.path}`);
  allow(target.host, target.port, what);
}
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { checkSocket(socketTarget(args), 'net'); return socketConnect.apply(this, args); };
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  const target = socketTarget(args);
  if (target.socket) throw new Error('기존 소켓 위 TLS 를 막았습니다');
  checkSocket(target, 'tls');
  return tlsConnect.apply(this, args);
};
const h2connect = http2.connect;
http2.connect = function (authority, ...rest) {
  const u = new URL(String(authority));
  allow(u.hostname, u.port || (u.protocol === 'https:' ? 443 : 80), 'http2');
  return h2connect.call(this, authority, ...rest);
};
// DNS: 이름 조회는 모두 막는다(허용 주소는 IP 라 조회가 필요 없다).
const denyDns = name => function () { throw new Error(`DNS 조회를 막았습니다(${name})`); };
const denyDnsAsync = name => function () { return Promise.reject(new Error(`DNS 조회를 막았습니다(${name})`)); };
const DNS_FNS = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveCaa', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
for (const f of DNS_FNS) {
  if (typeof dns[f] === 'function') dns[f] = denyDns(f);
  if (typeof dns.promises[f] === 'function') dns.promises[f] = denyDnsAsync(f);
  if (dns.Resolver && typeof dns.Resolver.prototype[f] === 'function') dns.Resolver.prototype[f] = denyDns(f);
  if (dns.promises.Resolver && typeof dns.promises.Resolver.prototype[f] === 'function') dns.promises.Resolver.prototype[f] = denyDnsAsync(f);
}
dgram.createSocket = function () { throw new Error('UDP 소켓을 막았습니다'); };
if (typeof globalThis.fetch === 'function') {
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    try {
      const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (u.protocol !== 'http:') throw new Error(`허용하지 않은 fetch 프로토콜을 막았습니다: ${u.protocol}`);
      allow(u.hostname, u.port || 80, 'fetch');
    } catch (e) { return Promise.reject(e); }
    return fetch.call(this, input, init);
  };
}

// ── 자격증명·설정 파일: 열기 전에 경로로 막는다 ──
const SECRET_PATH = /application_default_credentials\.json|[\\/]\.config[\\/]gcloud([\\/]|$)|[\\/]\.env(\.[^\\/]*)?$/;
const checkPath = p => { if (SECRET_PATH.test(String(p && p.href ? p.pathname : p))) throw new Error(`자격증명·설정 파일 접근을 막았습니다: ${p}`); };
for (const f of ['readFileSync', 'existsSync', 'statSync', 'openSync', 'accessSync', 'createReadStream']) {
  const orig = fs[f]; fs[f] = function (p, ...rest) { checkPath(p); return orig.call(this, p, ...rest); };
}
for (const f of ['readFile', 'stat', 'open', 'access']) {
  const orig = fs[f]; fs[f] = function (p, ...rest) { checkPath(p); return orig.call(this, p, ...rest); };
  const porig = fs.promises[f]; fs.promises[f] = function (p, ...rest) { try { checkPath(p); } catch (e) { return Promise.reject(e); } return porig.call(this, p, ...rest); };
}

// ── 스스로 확인: 막아야 할 것은 막히고, 에뮬레이터 연결만 된다. 하나라도 어긋나면 검사를 시작하지 않는다 ──
async function selfCheck() {
  const blocked = async (name, fn) => {
    try { const r = fn(); if (r && typeof r.then === 'function') await r; else if (r && r.destroy) r.destroy(); }
    catch (e) { if (/막았습니다/.test(e.message)) return name; throw new Error(`${name}: 차단 오류가 아닌 다른 오류 — ${e.message}`); }
    throw new Error(`${name}: 막혀야 하는데 통과했습니다`);
  };
  const negatives = await Promise.all([
    blocked('외부 TCP', () => net.connect(443, '93.184.215.14')),
    blocked('메타데이터 서버 TCP', () => net.connect({ host: '169.254.169.254', port: 80 })),
    blocked('다른 loopback 포트', () => net.connect(9150, HOST)),
    blocked('localhost 이름', () => net.connect(PORT, 'localhost')),
    blocked('Unix 소켓', () => net.connect('/tmp/minb-guard-probe.sock')),
    blocked('외부 TLS', () => tls.connect(443, '93.184.215.14')),
    blocked('외부 HTTP2', () => http2.connect('https://firestore.googleapis.com')),
    blocked('외부 fetch', () => globalThis.fetch('https://firestore.googleapis.com/')),
    blocked('DNS lookup', () => dns.promises.lookup('metadata.google.internal')),
    blocked('DNS resolve', () => dns.promises.resolve4('oauth2.googleapis.com')),
    blocked('UDP', () => dgram.createSocket('udp4')),
    blocked('ADC 파일', () => fs.existsSync(require('node:path').join(require('node:os').homedir(), '.config', 'gcloud', 'application_default_credentials.json')))
  ]);
  const positive = await new Promise((resolve, reject) => {
    const s = net.connect(PORT, HOST);
    s.once('connect', () => { s.destroy(); resolve(EMULATOR); });
    s.once('error', reject);
  });
  return { negatives, positive };
}

module.exports = { HOST, PORT, EMULATOR, PROJECT, selfCheck };
