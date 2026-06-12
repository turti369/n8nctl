import { describe, it, expect } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { N8nClient } from '../src/lib/api.js';
import { fetchAllTags } from '../src/lib/tags.js';
import type { ResolvedAuth } from '../src/lib/auth.js';
import type { WorkflowTag } from '../src/types/n8n.js';

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

function tagPage(start: number, count: number): WorkflowTag[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${start + i}`,
    name: `tag-${start + i}`,
  })) as WorkflowTag[];
}

describe('fetchAllTags', () => {
  it('returns a single page when there is no cursor', async () => {
    const { client, mock } = makeClient();
    mock.onGet('/tags').reply(200, { data: tagPage(0, 3) });
    const tags = await fetchAllTags(client);
    expect(tags).toHaveLength(3);
    expect(tags[0].name).toBe('tag-0');
  });

  // Regression: the old hard `limit: 250` silently dropped tags beyond the
  // first page, so `workflow tag` reported "Tag not found" for real tags.
  it('follows nextCursor across pages — no silent truncation above one page', async () => {
    const { client, mock } = makeClient();
    mock.onGet('/tags').reply((config) => {
      const cursor = (config.params as Record<string, unknown> | undefined)?.cursor;
      if (cursor === 'c2') return [200, { data: tagPage(250, 30), nextCursor: null }];
      return [200, { data: tagPage(0, 250), nextCursor: 'c2' }];
    });
    const tags = await fetchAllTags(client);
    expect(tags).toHaveLength(280);
    expect(tags.at(-1)?.name).toBe('tag-279');
  });
});
