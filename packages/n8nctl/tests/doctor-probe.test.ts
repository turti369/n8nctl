import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nClient } from '../src/lib/api.js';
import { isProbeTag, probeWritePermission } from '../src/commands/doctor.js';
import type { ResolvedAuth } from '../src/lib/auth.js';

const TEST_AUTH: ResolvedAuth = {
  host: 'https://test.example.com',
  apiKey: 'test-key',
  profileName: 'test',
  source: 'flag',
};

function makeClient(): { client: N8nClient; mock: MockAdapter } {
  const client = new N8nClient(TEST_AUTH, { baseBackoffMs: 1, timeout: 1000 });
  const mock = new MockAdapter((client as unknown as { http: axios.AxiosInstance }).http);
  return { client, mock };
}

describe('isProbeTag', () => {
  it('matches the fixed probe name', () => {
    expect(isProbeTag('n8nctl-doctor-probe')).toBe(true);
  });

  it('matches legacy random-suffix probes (12 base36 chars)', () => {
    expect(isProbeTag('n8nctl-tagoxhh3wofu')).toBe(true);
    expect(isProbeTag('n8nctl-abc123def456')).toBe(true);
  });

  it('does NOT match user-owned tags with n8nctl- prefix', () => {
    expect(isProbeTag('n8nctl-prod')).toBe(false);
    expect(isProbeTag('n8nctl-deploy')).toBe(false);
    expect(isProbeTag('n8nctl-')).toBe(false);
  });

  it('does NOT match unrelated tags', () => {
    expect(isProbeTag('production')).toBe(false);
    expect(isProbeTag('hot')).toBe(false);
  });

  it('does NOT match wrong-length suffixes', () => {
    expect(isProbeTag('n8nctl-short')).toBe(false); // 5 chars
    expect(isProbeTag('n8nctl-waytoolongsuffix99')).toBe(false); // >12
  });
});

describe('probeWritePermission — full read-write-delete key', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('creates one probe tag then deletes it — zero leftover', async () => {
    env.mock.onGet('/tags').reply(200, { data: [] });
    env.mock.onPost('/tags').reply(201, { id: 'probe-1', name: 'n8nctl-doctor-probe' });
    env.mock.onDelete('/tags/probe-1').reply(200, {});

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('ok');
    expect(out.delete?.status).toBe('ok');
    expect(out.delete?.detail).toMatch(/full read-write-delete/);
    expect(env.mock.history.post.length).toBe(1);
    expect(env.mock.history.delete.length).toBe(1);
  });

  it('cleans up legacy leftover probe tags when delete scope present', async () => {
    env.mock.onGet('/tags').reply(200, {
      data: [
        { id: 'old-1', name: 'n8nctl-tagoxhh3wofu' },
        { id: 'old-2', name: 'n8nctl-abc123def456' },
        { id: 'user-1', name: 'n8nctl-prod' }, // must be left untouched
      ],
    });
    env.mock.onDelete('/tags/old-1').reply(200, {});
    env.mock.onDelete('/tags/old-2').reply(200, {});

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('ok');
    expect(out.write.detail).toMatch(/reused/);
    expect(out.delete?.status).toBe('ok');
    // No new tag created (reuse path), 2 legacy tags deleted, user tag spared.
    expect(env.mock.history.post.length).toBe(0);
    const deletedUrls = env.mock.history.delete.map((d) => d.url);
    expect(deletedUrls).toContain('/tags/old-1');
    expect(deletedUrls).toContain('/tags/old-2');
    expect(deletedUrls).not.toContain('/tags/user-1');
  });
});

describe('probeWritePermission — create-only key (the tag-rác case)', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('first run: creates probe, delete 403 → warns with 1 remaining', async () => {
    env.mock.onGet('/tags').reply(200, { data: [] });
    env.mock.onPost('/tags').reply(201, { id: 'probe-1', name: 'n8nctl-doctor-probe' });
    env.mock.onDelete('/tags/probe-1').reply(403, { message: 'forbidden' });

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('ok');
    expect(out.delete?.status).toBe('warn');
    expect(out.delete?.detail).toMatch(/CREATE but not DELETE/);
    expect(out.delete?.detail).toMatch(/1 probe tag/);
  });

  it('subsequent run: reuses existing probe, does NOT create a new tag', async () => {
    // This is the regression guard: pre-0.4.0 each run POSTed a fresh tag,
    // accumulating one per run. Now an existing probe short-circuits create.
    env.mock.onGet('/tags').reply(200, {
      data: [{ id: 'probe-1', name: 'n8nctl-doctor-probe' }],
    });
    env.mock.onDelete('/tags/probe-1').reply(403, { message: 'forbidden' });

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('ok');
    expect(out.write.detail).toMatch(/reused/);
    expect(out.delete?.status).toBe('warn');
    // The crux: NO POST happened — tag count cannot grow.
    expect(env.mock.history.post.length).toBe(0);
  });

  it('does not accumulate: 10 sequential runs create at most 1 tag total', async () => {
    // Simulate a persistent store where created tags survive (delete 403s).
    const store: Array<{ id: string; name: string }> = [];
    let idSeq = 0;
    env.mock.onGet('/tags').reply(() => [200, { data: [...store] }]);
    env.mock.onPost('/tags').reply((config) => {
      const body = JSON.parse(config.data as string) as { name: string };
      const tag = { id: `probe-${++idSeq}`, name: body.name };
      store.push(tag);
      return [201, tag];
    });
    env.mock.onDelete(/\/tags\/.*/).reply(403, { message: 'forbidden' });

    for (let i = 0; i < 10; i++) {
      await probeWritePermission(env.client);
    }
    expect(store.length).toBe(1); // exactly one probe tag ever created
  });
});

describe('probeWritePermission — read-only key', () => {
  let env: ReturnType<typeof makeClient>;
  beforeEach(() => {
    env = makeClient();
  });

  it('POST 403 → write fails, no delete check emitted', async () => {
    env.mock.onGet('/tags').reply(200, { data: [] });
    env.mock.onPost('/tags').reply(403, { message: 'forbidden' });

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('fail');
    expect(out.write.detail).toMatch(/READ-ONLY/);
    expect(out.delete).toBeUndefined();
  });

  it('non-403 POST error → write warns (not fail)', async () => {
    env.mock.onGet('/tags').reply(200, { data: [] });
    env.mock.onPost('/tags').reply(500, { message: 'server boom' });

    const out = await probeWritePermission(env.client);
    expect(out.write.status).toBe('warn');
  });
});

describe('probeWritePermission — defensive', () => {
  it('tolerates null data in /tags response', async () => {
    const { client, mock } = makeClient();
    mock.onGet('/tags').reply(200, {});
    mock.onPost('/tags').reply(201, { id: 'p', name: 'n8nctl-doctor-probe' });
    mock.onDelete('/tags/p').reply(200, {});
    const out = await probeWritePermission(client);
    expect(out.write.status).toBe('ok');
  });
});
