// H5 is canonical for common gameplay/rendering; WeChat UI and lifecycle stay platform-specific.
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.find(a => a.startsWith('--target='))?.slice(9) || path.join(base, '../water-ring-wechatgame'));
const check = process.argv.includes('--check');
if (!fs.existsSync(path.join(target, 'game.js'))) throw new Error('WeChat directory missing: ' + target);
const source = fs.readFileSync(path.join(base, 'game.js'), 'utf8');
const original = fs.readFileSync(path.join(target, 'game.js'), 'utf8');
let output = original;
const names = ['makeRings','heightFactor','firePulse','resolvePoleContact','stepPhysics','stepFireworks','stepBubbles','roundRect','hexToRgb','shade','pal','tankClip','stepFish','drawDecor','drawFish','drawPlankton','drawLanternLights','drawTank','drawCoralPoles','drawWeaponPoles','drawStaff','hoop','drawSpear','drawPalace','drawCaustics','drawPalaceLights','startGuardDash','stepGuards','drawGuards','drawGuardStrike','drawShrimp','drawCrab','drawAngerMark','drawPulses','drawRingUnder','drawRingTop','drawRingShadows','drawTreasure','drawFloor','drawGlassSheen','drawBubbles','spawnSplash','stepSplashes','drawSplashes'];
function extract(code, name) {
  const start = code.indexOf('function ' + name + '(');
  const end = code.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error('Missing function: ' + name);
  return code.slice(start, end + 2);
}
for (const name of names) output = output.replace(extract(output, name), extract(source, name));
const core = fs.readFileSync(path.join(base, 'shared-core.js'), 'utf8');
if (check) {
  if (output !== original || fs.readFileSync(path.join(target, 'shared-core.js'), 'utf8') !== core) {
    throw new Error('Shared code differs. Run node scripts/sync-wechat.cjs');
  }
  console.log('Shared core and ' + names.length + ' gameplay/rendering functions match.');
} else {
  fs.writeFileSync(path.join(target, 'game.js'), output);
  fs.writeFileSync(path.join(target, 'shared-core.js'), core);
  console.log('Synchronized ' + names.length + ' functions and shared core to ' + target);
}
