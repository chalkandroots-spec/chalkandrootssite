'use strict';
// Run: node --test tests/welcome-claim.test.js
// Local deterministic checks only; these do NOT validate deployed Netlify Blobs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimWelcome, makeClaimKey } = require('../netlify/functions/lib/welcome-claim');

test('stable claim keys are deterministic and distinct across submissions', () => {
  assert.equal(makeClaimKey('vault-signup', 'submission_0001'), makeClaimKey('vault-signup', 'submission_0001'));
  assert.notEqual(makeClaimKey('vault-signup', 'submission_0001'), makeClaimKey('vault-signup', 'submission_0002'));
  assert.notEqual(makeClaimKey('vault-signup', 'submission_0001'), makeClaimKey('quiz-result', 'submission_0001'));
  assert.throws(() => makeClaimKey('vault-signup', 'bad'));
});

test('two concurrent claims for same submission yield exactly one winner', async () => {
  const existing = new Set();
  const store = {
    async setJSON(key, value, opts) {
      assert.equal(opts.onlyIfNew, true);
      assert.equal(value.state, 'claimed-pending-reconciliation');
      if (existing.has(key)) return { modified: false };
      existing.add(key);
      return { modified: true, etag: 'verified-etag' };
    }
  };
  const results = await Promise.all([
    claimWelcome(store, 'vault-signup', 'submission_0001'),
    claimWelcome(store, 'vault-signup', 'submission_0001'),
  ]);
  assert.equal(results.filter(r => r.claimed).length, 1);
});

test('unknown, ambiguous, and failed storage responses fail closed', async () => {
  const store = result => ({ async setJSON() { return result; } });
  await assert.rejects(claimWelcome(store({ modified: true }), 'vault-signup', 'submission_0001'));
  await assert.rejects(claimWelcome(store({}), 'vault-signup', 'submission_0001'));
  await assert.rejects(claimWelcome({ async setJSON() { throw Error('offline'); } }, 'vault-signup', 'submission_0001'));
});
