const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--dir', ...process.argv.slice(2)], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, FANOOS_EVS_SIGN: '1' }, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
