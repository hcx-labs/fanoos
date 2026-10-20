const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hook } = require('./evs-sign.cjs');
test('VMP signing uses platform-specific code-signing order and fails closed', async () => {
  const previous = process.env.FANOOS_EVS_SIGN;
  process.env.FANOOS_EVS_SIGN = '1';
  try {
    const calls = [];
    const sign = (directory) => calls.push(directory);
    for (const platform of ['darwin', 'win32', 'linux']) {
      for (const phase of ['afterPack', 'afterSign']) {
        await hook({ electronPlatformName: platform, appOutDir: `${platform}/${phase}` }, phase, sign);
      }
    }
    assert.deepEqual(calls, ['darwin/afterPack', 'win32/afterSign']);
    await assert.rejects(hook({ electronPlatformName: 'darwin', appOutDir: 'mac' }, 'afterPack', () => { throw new Error('EVS unavailable'); }), /EVS unavailable/);
  } finally {
    if (previous === undefined) delete process.env.FANOOS_EVS_SIGN;
    else process.env.FANOOS_EVS_SIGN = previous;
  }
});
