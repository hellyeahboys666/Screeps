'use strict';
// cpu.profile: checkpoint marks charge time to labels; a window summarises to Memory.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'cpu.profile.js'), 'utf8');

let used = 0;
const sandbox = {module: {exports: {}}, Memory: {}, Game: {time: 1000, cpu: {getUsed: () => used, bucket: 9000}}};
vm.runInNewContext(source, sandbox, {filename: 'cpu.profile.js'});
const prof = sandbox.module.exports;

for (let t = 0; t < prof.WINDOW; t++) {
    sandbox.Game.time = 1000 + t;
    used = 0.5;                 // CPU before the loop (global, compile)
    prof.start();
    used += 1; prof.mark('memoryParse');
    used += 2; prof.mark('role:lorry');
    used += 2; prof.mark('role:lorry');
    used += 0.25; prof.mark('spawn:decide');
    prof.end();
    if (t < prof.WINDOW - 1) assert.strictEqual(sandbox.Memory.cpuProfile, undefined, 'summary only at window end');
}
const p = sandbox.Memory.cpuProfile;
assert.strictEqual(p.ticks, prof.WINDOW);
assert.strictEqual(p.perTick['role:lorry'], 4, 'two marks per tick add up');
assert.strictEqual(p.perTick.memoryParse, 1);
assert.strictEqual(p.calls['role:lorry'].n, 2);
assert.strictEqual(p.avgTotal, 5.75);
assert.deepStrictEqual(Object.keys(p.perTick), ['role:lorry', 'memoryParse', 'spawn:decide'], 'largest first');

sandbox.Memory.cpuProfileEnabled = false;
delete sandbox.Memory.cpuProfile;
for (let t = 0; t < prof.WINDOW + 5; t++) { sandbox.Game.time = 3000 + t; prof.start(); prof.mark('x'); prof.end(); }
assert.strictEqual(sandbox.Memory.cpuProfile, undefined, 'disabled writes nothing');
console.log('cpu profile tests passed');
