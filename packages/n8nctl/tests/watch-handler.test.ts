import { describe, it, expect } from 'vitest';
import { makeFakeFactory } from './helpers/fake-factory.js';
import { watchHandler } from '../src/commands/workflow/watch.js';

/**
 * Exercises the watch loop's stop path WITHOUT emitting a real SIGINT (which
 * would also hit vitest's own signal handlers): grab the listener the handler
 * registers, invoke it directly, and assert the loop exits promptly and cleans
 * its listeners up.
 */
describe('workflow watch', () => {
  it('primes the seen-set, stops via the SIGINT listener, and removes its listeners', async () => {
    const env = makeFakeFactory();
    env.apiMock.onGet('/executions').reply(200, { data: [{ id: 'e1', workflowId: 'w1', status: 'success' }] });

    const before = process.listeners('SIGINT');
    const run = watchHandler(env.factory, { interval: '1000' }, []);

    // Wait for the handler to register its stop listener (prime poll done).
    let added: NodeJS.SignalsListener | undefined;
    for (let i = 0; i < 100 && !added; i++) {
      await new Promise((r) => setTimeout(r, 10));
      added = process.listeners('SIGINT').find((l) => !before.includes(l));
    }
    expect(added).toBeDefined();

    added!('SIGINT');
    await run; // resolves once the loop notices `stopped` (≤ poll interval)

    // Listener cleaned up (finally block) and clean exit message emitted.
    expect(process.listeners('SIGINT')).not.toContain(added);
    expect(env.stderr()).toContain('watch stopped');
    // Primed executions are marked seen, not re-emitted as new rows.
    expect(env.stdout()).not.toContain('e1');
  }, 15000);
});
