import assert from 'node:assert/strict';

const [baseUrl = 'http://127.0.0.1:8080', ...additionalArguments] = process.argv.slice(2);
const origin = new URL(baseUrl);
assert.deepEqual(additionalArguments, [], 'Usage: node scripts/smoke.mjs [loopback-base-url]');
assert.ok(
  ['http:', 'https:'].includes(origin.protocol)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    && !origin.username && !origin.password
    && origin.pathname === '/' && !origin.search && !origin.hash,
  'Use a loopback origin without credentials, path, query, or fragment',
);

const cookies = new Map();

function cookieHeader() {
  return [...cookies].map(([name, value]) => name + '=' + value).join('; ');
}

function updateCookies(headers) {
  for (const setCookie of headers.getSetCookie()) {
    const [pair, ...attributes] = setCookie.split(';');
    const valueStart = pair.indexOf('=');
    if (valueStart < 1) continue;

    const name = pair.slice(0, valueStart).trim();
    const value = pair.slice(valueStart + 1).trim();
    const maxAge = attributes.find((attribute) => /^ *max-age=/i.test(attribute));
    const expires = attributes.find((attribute) => /^ *expires=/i.test(attribute));
    const expired = maxAge
      ? Number(maxAge.split('=')[1]) <= 0
      : expires && Date.parse(expires.split('=')[1]) <= Date.now();
    if (!value || expired) cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function request(path, {
  method = 'GET',
  status = 200,
  payload,
  csrf,
  previousSession,
} = {}) {
  const headers = new Headers({ Accept: 'application/json' });
  const cookie = previousSession ?? cookieHeader();
  if (cookie) headers.set('Cookie', cookie);
  if (payload !== undefined) headers.set('Content-Type', 'application/json');
  if (csrf) headers.set(csrf.headerName, csrf.token);

  const response = await fetch(new URL('/api/v1' + path, origin), {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });

  if (previousSession === undefined) updateCookies(response.headers);
  const operation = method + ' ' + path;
  assert.equal(response.status, status, operation + ' HTTP status');
  assert.ok(response.headers.get('x-request-id')?.trim(), operation + ' request ID');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i, operation + ' content type');

  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['code', 'data', 'message'], operation + ' response envelope');
  assert.equal(typeof result.code, 'string', operation + ' response code');
  assert.ok(typeof result.message === 'string' && result.message.trim(), operation + ' response message');
  if (status < 400) assert.equal(result.code, '0', operation + ' success code');
  else assert.notEqual(result.code, '0', operation + ' failure code');
  return result.data;
}

async function getCsrf() {
  const csrf = await request('/auth/csrf');
  assert.match(csrf.headerName, /^X-[\w-]+$/i, 'CSRF header name');
  assert.ok(typeof csrf.token === 'string' && csrf.token.length > 0, 'CSRF token');
  return csrf;
}

function assertIdentity(identity, defaultProjectId, landingPath) {
  assert.equal(identity.mode, 'demo');
  assert.equal(identity.defaultProjectId, defaultProjectId);
  assert.equal(identity.landingPath, landingPath);
  for (const property of ['id', 'displayName', 'department']) {
    assert.ok(typeof identity[property] === 'string' && identity[property].trim(), 'Identity ' + property);
  }
  for (const property of ['roles', 'permissions']) {
    assert.ok(identity[property].length > 0 && identity[property].every((item) => typeof item === 'string'),
      'Identity ' + property);
  }
}

async function assertProjects(expectedIds) {
  const projects = await request('/projects/recommendations');
  assert.deepEqual(projects.map(({ id }) => id), expectedIds);
  for (const project of projects) {
    for (const property of ['name', 'description', 'theme', 'reason']) {
      assert.ok(typeof project[property] === 'string' && project[property].trim(), 'Project ' + property);
    }
  }
}

const city = 'city-operations';
const service = 'public-services';
const manifestPath = (projectId) => '/playback/' + projectId + '/manifest';
const queryPath = (projectId) => '/playback/' + projectId + '/component-queries';

const areaPath = (id) => '/cockpit/areas/' + id;
const overview = await request(areaPath('mentougou'));
assert.equal(overview.level, 'district');
assert.equal(overview.quality, 'SIMULATED');
assert.equal(overview.children.length, 13);
assert.ok(overview.metrics.length >= 8);
const town = await request(areaPath('miaofengshan'));
assert.equal(town.level, 'town');
assert.ok(overview.children.some((child) => child.id === town.id));
const village = await request(areaPath('miaofengshan-longjiazhuang'));
assert.equal(village.level, 'village');
assert.ok(town.children.some((child) => child.id === village.id));
assert.deepEqual(village.breadcrumbs.map((item) => item.id), [overview.id, town.id, village.id]);
assert.equal(village.children.length, 0);
assert.deepEqual(village.metrics.map((item) => item.id), overview.metrics.map((item) => item.id));
await request(areaPath('absent-area'), { status: 404 });

await request('/me', { status: 401 });
await request('/auth/demo-session', { method: 'POST', status: 403, payload: { persona: 'district' } });

const districtIdentity = await request('/auth/demo-session', {
  method: 'POST',
  csrf: await getCsrf(),
  payload: { persona: 'district' },
});
assertIdentity(districtIdentity, city, '/');
assert.deepEqual(await request('/me'), districtIdentity);
await assertProjects([city, service]);

const manifest = await request(manifestPath(city));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.projectId, city);
assert.ok(typeof manifest.releaseId === 'string' && manifest.releaseId.length > 0, 'Manifest release ID');
assert.ok(manifest.canvas && typeof manifest.canvas === 'object', 'Manifest canvas');
const components = manifest.components;
assert.ok(Array.isArray(components) && components.length > 0, 'Manifest components');
for (const component of components) {
  assert.ok(component.id && component.title && component.metricId && component.type && component.geometry,
    'Manifest component fields');
}

const districtCsrf = await getCsrf();
const payload = { releaseId: manifest.releaseId, componentIds: components.map(({ id }) => id) };
const batch = await request(queryPath(city), { method: 'POST', csrf: districtCsrf, payload });
assert.equal(batch.projectId, city);
assert.equal(batch.releaseId, manifest.releaseId);
assert.equal(batch.quality, 'SIMULATED');
assert.ok(batch.snapshotId && Number.isFinite(Date.parse(batch.updatedAt)), 'Batch snapshot and timestamp');
assert.deepEqual(batch.results.map(({ componentId }) => componentId).sort(), [...payload.componentIds].sort());
for (const result of batch.results) {
  const component = components.find(({ id }) => id === result.componentId);
  assert.equal(result.metricId, component.metricId);
  assert.equal(result.unit, component.unit);
  assert.ok(Number.isFinite(result.value) || result.points?.length > 0, 'Batch scalar or series value');
  for (const point of result.points ?? []) {
    assert.ok(typeof point.label === 'string' && Number.isFinite(point.value), 'Batch series point');
  }
}

await request(manifestPath('missing-project'), { status: 404 });
await request(queryPath(city), {
  method: 'POST',
  status: 409,
  csrf: districtCsrf,
  payload: { ...payload, releaseId: 'stale-release' },
});

const districtSession = cookieHeader();
assert.ok(districtSession, 'District session cookie exists');
const serviceIdentity = await request('/auth/demo-session', {
  method: 'POST',
  csrf: districtCsrf,
  payload: { persona: 'service' },
});
assertIdentity(serviceIdentity, service, '/play/public-services');
assert.notEqual(serviceIdentity.id, districtIdentity.id);
assert.deepEqual(await request('/me'), serviceIdentity);
await assertProjects([service]);
assert.equal((await request(manifestPath(service))).projectId, service);
await request(manifestPath(city), { status: 404 });
const serviceCsrf = await getCsrf();
await request(queryPath(city), { method: 'POST', status: 404, csrf: serviceCsrf, payload });
await request('/me', { status: 401, previousSession: districtSession });

const serviceSession = cookieHeader();
assert.equal(await request('/auth/logout', { method: 'POST', csrf: serviceCsrf }), null);
await request('/me', { status: 401 });
await request('/me', { status: 401, previousSession: serviceSession });
console.log('PASS demo API smoke: anonymous cockpit, district/town/village, role landing, CSRF, session rotation, protected playback and logout.');
