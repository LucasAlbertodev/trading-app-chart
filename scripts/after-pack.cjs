// electron-builder afterPack hook (macOS): signs AlbertosCharts.app with the local certificate
// from scripts/signing-setup.sh, so every build keeps the same code identity and macOS stops
// asking for the keychain password after each update. Without that certificate it falls back to
// an ad-hoc signature (and says so).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME = 'AlbertosCharts Local Signing';
const DIR = path.join(os.homedir(), 'Library', 'Application Support', 'AlbertosCharts-signing');
const KC = path.join(DIR, 'signing.keychain-db');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function userKeychains() {
  return run('security', ['list-keychains', '-d', 'user'])
    .split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  if (!fs.existsSync(KC) || !fs.existsSync(path.join(DIR, 'keychain-password'))) {
    console.warn(`  • no local signing certificate (run scripts/signing-setup.sh): signing ad hoc.
    macOS will ask for the keychain password again after this update.`);
    run('codesign', ['--force', '--deep', '--sign', '-', app]);
    return;
  }

  const pass = fs.readFileSync(path.join(DIR, 'keychain-password'), 'utf8').trim();
  run('security', ['unlock-keychain', '-p', pass, KC]);
  const sha = /SHA-1 hash: ([0-9A-F]{40})/.exec(run('security', ['find-certificate', '-c', NAME, '-Z', KC]))?.[1];
  if (!sha) throw new Error(`"${NAME}" not found in ${KC}`);

  // codesign only finds identities in keychains on the search list: add ours for the signing step
  // and always put the list back as it was.
  const before = userKeychains();
  try {
    run('security', ['list-keychains', '-d', 'user', '-s', ...before.filter((k) => k !== KC), KC]);
    run('codesign', ['--force', '--deep', '--timestamp=none', '--sign', sha, app]);
  } finally {
    run('security', ['list-keychains', '-d', 'user', '-s', ...before]);
  }
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const req = run('codesign', ['-d', '-r-', app], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`  • signed with "${NAME}" (${sha.slice(0, 8)}…): ${(/designated => (.*)/.exec(req) || [])[1] || ''}`);
};
