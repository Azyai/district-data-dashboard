import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:8080');
assert.ok(
  ['http:', 'https:'].includes(origin.protocol) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) &&
  !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash,
  'Use a local demo origin with no credentials or path',
);
const admin = '/admin';
let cookie = '';

async function api(path, { method = 'GET', data, headers: additional, status = 200, code, csrf = method !== 'GET' } = {}) {
  const headers = new Headers(additional);
  headers.set('Accept', 'application/json');
  if (csrf) {
    const token = await api('/auth/csrf');
    headers.set(token.headerName, token.token);
  }
  if (cookie) headers.set('Cookie', cookie);
  let body = data;
  if (data !== undefined && !(data instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(data);
  }
  const response = await fetch(new URL('/api/v1' + path, origin), {
    method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  for (const next of response.headers.getSetCookie()) {
    const session = next.split(';', 1)[0];
    if (session.startsWith('DISTRICT_SESSION=')) cookie = session;
  }
  const result = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ' ' + result.code + ' ' + result.message);
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(result.code, code ?? (status === 200 ? '0' : result.code));
  return result.data;
}

const post = (path, data, headers) => api(path, { method: 'POST', data, headers });
const version = value => ({ 'If-Match': '"' + value + '"' });
const login = persona => post('/auth/demo-session', { persona });
await api(admin + '/sources', { status: 401, code: 'AUTH_REQUIRED' });
await login('district');
await api(admin + '/sources', { status: 403, code: 'ACCESS_DENIED' });
const identity = await login('data-admin');
assert.ok(identity.roles.includes('DATA_ADMIN'));
assert.equal(identity.landingPath, '/admin');

const sourceIds = ['p2-https-events', 'p2-mysql-cases', 'p2-csv-air'];
const metricIds = ['governance-events', 'service-cases', 'air-quality-rate'];
const existingSources = await api(admin + '/sources');
const existingMetrics = await api(admin + '/metrics');
assert.ok(sourceIds.every(id => !existingSources.some(source => source.id === id)) &&
  metricIds.every(id => !existingMetrics.some(metric => metric.id === id)),
'Smoke writes the P2 acceptance fixtures. Use an isolated empty catalog for the first run.');

const options = await api(admin + '/source-options');
const https = options.httpsEndpoints.find(item => new URL(item.endpoint).pathname === '/data.json');
const invalid = options.httpsEndpoints.find(item => new URL(item.endpoint).pathname === '/invalid.json');
const mysql = options.mysqlConnections.find(item => item.id === 'fixture');
assert.ok(https && invalid && mysql?.views.some(view => view.id === 'observations'),
  'Start the P2 fixtures and register /data.json, /invalid.json and fixture/observations');

const upload = new FormData();
const csv = await readFile(new URL('../fixtures/p2/air-observations.csv', import.meta.url));
upload.append('file', new Blob([csv], { type: 'text/csv' }), 'air-observations.csv');
const asset = await post(admin + '/source-assets', upload);
assert.equal(asset.sizeBytes, csv.length);

const mapping = { region: 'region', date: 'date', measure: 'measure', value: 'value' };
const inputs = [
  { id: sourceIds[0], name: 'HTTPS 治理事件', type: 'HTTPS_JSON', config: { endpoint: https.endpoint }, mapping },
  { id: sourceIds[1], name: 'MySQL 政务办件', type: 'MYSQL_VIEW', config: { connectionRef: mysql.id, viewRef: 'observations' }, mapping },
  { id: sourceIds[2], name: 'CSV 空气监测', type: 'CSV', config: { assetRef: asset.id }, mapping: { ...mapping, denominator: 'denominator' } },
].map(source => ({ ...source, refreshMinutes: 0 }));

const sources = [];
for (const input of inputs) {
  const source = await post(admin + '/sources', input);
  const path = admin + '/sources/' + source.id;
  const tested = await post(path + '/connection-tests');
  assert.equal(tested.status, 'PASSED', input.type + ': ' + tested.message);
  assert.equal(tested.totalRows, 21);
  assert.ok(tested.preview.length > 0 && tested.preview.every(row => row.regionId && row.observedOn));
  const key = { 'Idempotency-Key': 'p2-fixture-' + source.id };
  const run = await post(path + '/sync-runs', {}, key);
  assert.equal(run.status, 'SUCCEEDED', input.type + ': ' + run.message);
  assert.equal(run.rowsAccepted, 21);
  const repeated = await post(path + '/sync-runs', {}, key);
  assert.equal(repeated.id, run.id);
  const dataset = await api(path + '/dataset');
  assert.equal(dataset.rowCount, 21);
  assert.equal(dataset.batchId, run.batchId);
  sources.push({ input, source, path, dataset });
  console.log('PASS ' + input.type + ' connection, normalized preview, sync batch and idempotent replay');
}

const specs = [
  { label: '治理事件受理', unit: '件', aggregation: 'SUM', district: 1708, village: 48 },
  { label: '政务服务办件', unit: '件', aggregation: 'SUM', district: 2836, village: 81 },
  { label: '优良空气监测占比', unit: '%', aggregation: 'RATE', district: 96, village: 99 },
];
for (const [index, spec] of specs.entries()) {
  const { source, dataset } = sources[index];
  const record = await post(admin + '/metrics', {
    id: metricIds[index], label: spec.label, unit: spec.unit, sourceId: source.id,
    measure: dataset.measures[0], aggregation: spec.aggregation, description: 'P2 临时合成观测',
  });
  const published = await post(admin + '/metrics/' + record.id + '/publish', undefined, version(record.revision));
  assert.equal(published.published.version, 1);
}

for (const [areaId, scale] of [['mentougou', 'district'], ['miaofengshan-longjiazhuang', 'village']]) {
  const cockpit = await api('/cockpit/areas/' + areaId);
  for (const [index, spec] of specs.entries()) {
    const metric = cockpit.metrics.find(item => item.id === metricIds[index]);
    assert.equal(metric.value, spec[scale], metric.id + ' in ' + areaId);
    assert.equal(metric.evidence.batchId, sources[index].dataset.batchId);
    assert.equal(metric.evidence.version, 1);
  }
  assert.equal(cockpit.trend.at(-1).value, specs[0][scale]);
  assert.deepEqual(cockpit.distribution, []);
}

const sample = sources[0];
const versioned = await api(sample.path, {
  method: 'PUT', data: { ...sample.input, config: { endpoint: invalid.endpoint } }, headers: version(sample.source.version),
});
await api(sample.path, { method: 'PUT', data: sample.input, headers: version(sample.source.version),
  status: 409, code: 'VERSION_CONFLICT' });
const rejected = await post(sample.path + '/sync-runs', {});
assert.equal(rejected.status, 'REJECTED');
assert.ok(rejected.rowsRejected > 0);
assert.equal((await api(sample.path + '/dataset')).batchId, sample.dataset.batchId);
const retained = await api('/cockpit/areas/mentougou');
assert.equal(retained.metrics.find(metric => metric.id === metricIds[0]).value, specs[0].district);
await api(sample.path, { method: 'PUT', data: sample.input, headers: version(versioned.version) });

console.log('PASS publish three indicators, district/village snapshots, stale edits and last-good data after batch rejection');
