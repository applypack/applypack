import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { csrfProtection } from './csrf';

function createTestApp(): Hono {
  const app = new Hono();
  app.use('*', csrfProtection());
  app.get('/test', (c) => c.text('get-ok'));
  app.post('/test', (c) => c.text('post-ok'));
  app.put('/test', (c) => c.text('put-ok'));
  app.delete('/test', (c) => c.text('delete-ok'));
  return app;
}

describe('csrfProtection', () => {
  const app = createTestApp();

  it('allows safe methods (GET, HEAD, OPTIONS) without restriction', async () => {
    const getRes = await app.request('/test', {
      method: 'GET',
      headers: {
        'sec-fetch-site': 'cross-site',
        origin: 'http://evil.com',
      },
    });
    assert.equal(getRes.status, 200);
    assert.equal(await getRes.text(), 'get-ok');

    const headRes = await app.request('/test', {
      method: 'HEAD',
      headers: {
        'sec-fetch-site': 'cross-site',
        origin: 'http://evil.com',
      },
    });
    assert.equal(headRes.status, 200);
  });

  it('rejects cross-site Sec-Fetch-Site with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        'sec-fetch-site': 'cross-site',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Cross-site request rejected/);
  });

  it('allows same-origin Sec-Fetch-Site', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        'sec-fetch-site': 'same-origin',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('allows Sec-Fetch-Site none', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        'sec-fetch-site': 'none',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('rejects malicious Origin with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        origin: 'http://evil.com',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Invalid request origin/);
  });

  it('allows valid same-origin Origin', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        origin: 'http://127.0.0.1:4747',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('rejects cross-port localhost Origin with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: 'localhost:4747',
        origin: 'http://localhost:3000',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Invalid request origin/);
  });

  it('rejects malformed Origin header with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        origin: 'not-a-valid-url',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Malformed Origin header/);
  });

  it('supports reverse proxy via X-Forwarded-Host', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        'x-forwarded-host': 'dashboard.example.com',
        origin: 'https://dashboard.example.com',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('rejects malicious Referer fallback with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        referer: 'http://evil.com/attacker-form',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Invalid request referer/);
  });

  it('allows valid same-origin Referer fallback', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        referer: 'http://127.0.0.1:4747/jobs/123',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('rejects malformed Referer header with 403', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
        referer: ':::invalid-url',
      },
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Forbidden: Malformed Referer header/);
  });

  it('allows non-browser clients with no browser security headers', async () => {
    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4747',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'post-ok');
  });

  it('protects PUT and DELETE methods as well', async () => {
    const putRes = await app.request('/test', {
      method: 'PUT',
      headers: {
        host: '127.0.0.1:4747',
        'sec-fetch-site': 'cross-site',
      },
    });
    assert.equal(putRes.status, 403);

    const deleteRes = await app.request('/test', {
      method: 'DELETE',
      headers: {
        host: '127.0.0.1:4747',
        origin: 'http://evil.com',
      },
    });
    assert.equal(deleteRes.status, 403);
  });
});
