const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

function python() {
  const local = path.join(__dirname, '..', '.venv-evs', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return process.env.EVS_PYTHON || (existsSync(local) ? local : 'python3');
}
function sign(directory) {
  // EVS checks existing signatures itself. Never force a new signing request.
  const result = spawnSync(python(), ['-m', 'castlabs_evs.vmp', '--no-ask', 'sign-pkg', directory], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('EVS VMP signing failed. Install castlabs-evs and sign in with python -m castlabs_evs.account reauth. See apps/desktop/README.md.');
  const verify = spawnSync(python(), ['-m', 'castlabs_evs.vmp', '--no-ask', 'verify-pkg', directory], { stdio: 'inherit' });
  if (verify.error || verify.status !== 0) throw new Error('EVS VMP signature verification failed.');
}
async function hook(context, phase, signer = sign) {
  const platform = context.electronPlatformName;
  if (platform === 'linux') return;
  if ((platform === 'darwin' && phase !== 'afterPack') || (platform === 'win32' && phase !== 'afterSign')) return;
  const enabled = process.env.FANOOS_EVS_SIGN === '1' || process.env.npm_lifecycle_event === 'dist';
  if (!enabled) {
    console.warn('Local build: production Widevine signing skipped. Use npm run pack:drm for Crunchyroll playback.');
    return;
  }
  signer(context.appOutDir);
}
module.exports = { hook, sign, python };
if (require.main === module) sign(path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', process.platform === 'darwin' ? 'mac-arm64' : 'win-unpacked')));
