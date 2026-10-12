'use strict';
const crypto = require('node:crypto');
function makeClaimKey(formName, submissionId) {
  if (!/^[a-z0-9-]{2,60}$/.test(formName) || !/^[A-Za-z0-9_-]{8,128}$/.test(submissionId)) {
    throw new Error('Valid form and stable Netlify submission ID required');
  }
  return 'resource-welcome-v1/' + crypto.createHash('sha256').update(formName + ':' + submissionId).digest('hex');
}
async function claimWelcome(store, formName, submissionId) {
  const key = makeClaimKey(formName, submissionId);
  const result = await store.setJSON(key, {
    formName, submissionId, state: 'claimed-pending-reconciliation', createdAt: new Date().toISOString(),
  }, { onlyIfNew: true });
  // Some published SDK versions may report modified:true on HTTP failures.
  // An accepted write must return a nonempty ETag; otherwise fail closed.
  if (result.modified === true && (!result.etag || typeof result.etag !== 'string')) {
    throw new Error('Unverified Netlify Blobs conditional write; held for review');
  }
  if (result.modified !== true && result.modified !== false) {
    throw new Error('Unexpected Netlify Blobs claim response');
  }
  return { claimed: result.modified === true, key };
}
module.exports = { makeClaimKey, claimWelcome };
