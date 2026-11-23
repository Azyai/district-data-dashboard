import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';

const [command, directory, portInput = '18443'] = process.argv.slice(2);
if (!['prepare', 'serve'].includes(command) || !directory) {
  throw new Error('Usage: node scripts/p2-https-fixture.mjs prepare|serve <fixture-directory> [port]');
}

const target = resolve(directory);
const serverStore = resolve(target, 'fixture-server.p12');
const certFile = resolve(target, 'fixture-https.pem');
const trustStore = resolve(target, 'fixture-trust.p12');
const fixturePassword = 'fixture-only';

function keytool(...args) {
  const result = spawnSync('keytool', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('JDK keytool failed');
}

if (command === 'prepare') {
  mkdirSync(target, { recursive: true });
  if (!existsSync(serverStore)) {
    keytool('-genkeypair', '-alias', 'district-https-fixture', '-keyalg', 'RSA', '-keysize', '2048',
      '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost,ip:127.0.0.1', '-validity', '30',
      '-storetype', 'PKCS12', '-keystore', serverStore, '-storepass', fixturePassword);
  }
  if (!existsSync(certFile)) {
    keytool('-exportcert', '-rfc', '-alias', 'district-https-fixture',
      '-keystore', serverStore, '-storepass', fixturePassword, '-file', certFile);
  }
  if (!existsSync(trustStore)) {
    keytool('-importcert', '-noprompt', '-storetype', 'PKCS12', '-alias', 'district-https-fixture',
      '-keystore', trustStore, '-storepass', fixturePassword, '-file', certFile);
  }
  console.log('Local HTTPS fixture truststore ready: ' + trustStore);
} else {
  const port = Number(portInput);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a valid development port');
  const rows = [
    ['mentougou', [1511, 1550, 1539, 1583, 1614, 1644, 1708]],
    ['miaofengshan', [121, 128, 125, 132, 130, 136, 142]],
    ['miaofengshan-longjiazhuang', [32, 37, 34, 41, 39, 45, 48]],
  ].flatMap(([region, values]) =>
    values.map((value, index) => ({ region, date: '2026-11-' + (17 + index), measure: 'events', value })),
  );
  const options = { pfx: readFileSync(serverStore), passphrase: fixturePassword };
  const server = createServer(options, (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    const payloads = {
      '/data.json': rows,
      '/alternate.json': rows.map(row => ({ ...row, value: row.value + 7 })),
      '/invalid.json': [...rows, { region: '', date: 'not-a-date', measure: 'events', value: 0 }],
    };
    const payload = payloads[request.url];
    if (!payload) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload));
  });
  server.listen(port, '127.0.0.1', () => console.log('Synthetic measurements at https://localhost:' + port + '/data.json'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
