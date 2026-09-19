// Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9095
// firebase emulators:exec --only firestore,auth --project demo-ueda-traces "node --test tests/visitor-traces-rules.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const project = 'demo-ueda-traces';
const lifetime = 60 * 86400000;
const local = value => /^127\.0\.0\.1:\d+$/.test(value || '');

test('Firestore trace rules accept shared anonymous walks and reject invalid writes',
  { skip: !host || !authHost }, async () => {
    assert.ok(local(host) && local(authHost), 'This test must only access localhost emulators');
    const auth = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    }).then(r => r.json());
    assert.ok(auth.idToken);
    const encode = value => {
      if (value instanceof Date) return { timestampValue: value.toISOString() };
      if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
      if (value && typeof value === 'object') return { mapValue: { fields: fields(value) } };
      if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
      return { stringValue: value };
    };
    const fields = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]));
    const base = () => ({ room: 0, layout: 'traces-v1-abcdef',
      points: Array.from({ length: 6 }, (_, i) => ({ x: i % 2 ? .095 : -.095, z: 10 - i * .65, angle: 0 })),
      expiresAt: new Date(Date.now() + lifetime) });
    const url = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
    const write = async (data, { authenticated = true, serverTime = true, id = crypto.randomUUID() } = {}) => {
      const response = await fetch(`${url}:commit`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${auth.idToken}` } : {}) },
        body: JSON.stringify({ writes: [{ update: { name: `projects/${project}/databases/(default)/documents/visitorTraces/${id}`, fields: fields(data) },
          ...(serverTime ? { updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] } : {}) }] }),
      });
      return { status: response.status, body: await response.text(), id };
    };
    const good = await write(base()); assert.equal(good.status, 200, good.body);
    const read = await fetch(`${url}/visitorTraces/${good.id}`); assert.equal(read.status, 200);
    const saved = await read.json(); assert.equal(saved.fields.points.arrayValue.values.length, 6);
    assert.equal(saved.fields.ownerId, undefined);
    assert.equal((await write(base(), { authenticated: false })).status, 403);
    const bads = [
      { ...base(), points: base().points.slice(0, 5) },
      { ...base(), points: base().points.map((p, i) => i === 5 ? { ...p, x: 999 } : p) },
      { ...base(), points: base().points.map(p => ({ ...p, angle: 4 })) },
      { ...base(), points: base().points.map((p, i) => i === 3 ? { ...p, z: -30 } : p) },
      { ...base(), room: 7 }, { ...base(), room: .5 }, { ...base(), layout: 'unknown' },
      { ...base(), name: 'must not be stored' }, { ...base(), expiresAt: new Date(Date.now() - 1) },
      { ...base(), expiresAt: new Date(Date.now() + lifetime + 86400000) },
    ];
    for (const data of bads) { const result = await write(data); assert.equal(result.status, 403, result.body); }
    assert.equal((await write({ ...base(), createdAt: new Date(0) }, { serverTime: false })).status, 403);
    assert.equal((await write(base(), { id: good.id })).status, 403, 'existing tracks are immutable');
    const del = await fetch(`${url}/visitorTraces/${good.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth.idToken}` } });
    assert.equal(del.status, 403);
  });
