const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared-core');
test('corrupt storage and level access are normalized', () => {
  for (const raw of [undefined, null, '', 'NaN', '2x', '2.5', -10]) assert.equal(core.normalizeUnlocked(raw), 1);
  assert.equal(core.normalizeUnlocked(99), 3);
  assert.equal(core.normalizeUnlocked('2'), 2);
  for (const raw of ['{', '[]', 'null', '4']) assert.deepEqual(core.normalizeScores(raw), {});
  assert.deepEqual(core.normalizeScores('{"day":80,"night":"60","dragon":90,"unknown":50}'), {day:80});
  for (const index of [-1,3,NaN,1.5]) assert.equal(core.canEnterLevel(index,3,true), false);
  assert.equal(core.canEnterLevel(1,1),false);
  assert.equal(core.canEnterLevel(1,1,true),true);
});
test('layout extremes and seeded layouts preserve spacing and boundaries', () => {
  let seed = 42;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let n=0;n<3002;n++) {
    const rings=core.makePositions(n===0?()=>0:n===1?()=>0.999999999:random);
    assert.equal(rings.length,6);
    assert(rings.some(r=>r.x<120)&&rings.some(r=>r.x>280));
    rings.forEach((r,i)=>{
      assert(r.x>=26 && r.x<=374 && r.y>=479 && r.y<=614);
      for(const x of [150,310]) assert(Math.abs(r.x-x)>=40);
      for(const other of rings.slice(0,i)) assert(Math.hypot(r.x-other.x,r.y-other.y)>=56);
    });
  }
});
test('color channels are clamped while preserving in-range shading',()=>{
  assert.equal(core.shade('#ffffff',0.4),'rgb(255,255,255)');
  assert.equal(core.shade('#000000',-2),'rgb(0,0,0)');
  assert.equal(core.shade('#808080',-0.5),'rgb(64,64,64)');
});
