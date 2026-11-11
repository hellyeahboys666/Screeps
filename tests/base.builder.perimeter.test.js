'use strict';
// Perimeter rampart planning (weighted min-cut) and its opt-in execution. Plain node, no live API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const {planPerimeter} = require(path.join(ROOT, 'base.builder.defense.js'));
const {Simulation} = require('./helpers/base.builder.sim.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const range = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function room(wallFn) {
    const terrain = new Array(2500).fill(0);
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (wallFn(x, y)) terrain[y * 50 + x] = 1;
    return {anchor: {id: 'a', pos: {x: 25, y: 35}}, controller: {pos: {x: 25, y: 45}}, terrain,
        structures: [], sites: [], spawns: [{type: 'spawn', pos: {x: 25, y: 35}, my: true, id: 'a'}],
        sources: [], minerals: []};
}
// Hostile reachability from exits, through non-wall tiles not in `blocked`.
function exposed(input, blocked, target, reach) {
    const seen = new Uint8Array(2500), q = [];
    const open = i => !input.terrain[i] && !blocked.has(i);
    for (let i = 0; i < 2500; i++) {
        const x = i % 50, y = (i - x) / 50;
        if ((x === 0 || x === 49 || y === 0 || y === 49) && open(i)) { seen[i] = 1; q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
        const x = q[h] % 50, y = (q[h] - x) / 50;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy, n = ny * 50 + nx;
            if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || seen[n] || !open(n)) continue;
            seen[n] = 1; q.push(n);
        }
    }
    for (let i = 0; i < 2500; i++) if (seen[i] && range({x: i % 50, y: Math.floor(i / 50)}, target) <= reach) return true;
    return false;
}

test('a walled valley with one 3-wide gap is sealed by exactly the gap', () => {
    // Only the top edge is open; a wall row at y=10 with a gap at x=24..26.
    const input = room((x, y) => y > 0 && (x === 0 || x === 49 || y === 49) || (y === 10 && (x < 24 || x > 26)));
    const result = planPerimeter(input, [], {});
    assert(!result.reason, result.reason);
    const cut = result.cut.map(i => ({x: i % 50, y: Math.floor(i / 50)}));
    assert.strictEqual(cut.length, 3);
    assert(cut.every(p => p.x >= 24 && p.x <= 26), JSON.stringify(cut));
    assert.strictEqual(exposed(input, new Set(result.cut), input.anchor.pos, 3), false);
});

test('never places ramparts within 1 tile of the room edge', () => {
    const input = room(() => false);
    const result = planPerimeter(input, [], {maxCutTiles: 150});
    assert(!result.reason, result.reason);
    assert(result.cut.every(i => { const x = i % 50, y = Math.floor(i / 50); return x >= 2 && x <= 47 && y >= 2 && y <= 47; }));
});

test('falls back to a smaller buffer instead of failing when the budget is tight', () => {
    const input = room(() => false);
    // Open room: a buffer-3 ring around the spawn needs 32 tiles, buffer 1 needs 16.
    const result = planPerimeter(input, [], {maxCutTiles: 20});
    assert(!result.reason, result.reason);
    assert.strictEqual(result.config.buffer, 1);
    assert(result.cut.length <= 20);
});

test('reports over-budget rather than placing a partial wall', () => {
    const input = room(() => false);
    const result = planPerimeter(input, [{type: 'extension', pos: {x: 5, y: 5}}, {type: 'extension', pos: {x: 44, y: 44}}],
        {maxCutTiles: 10});
    assert(result.reason && result.reason.startsWith('perimeterUnsupported'), JSON.stringify(result.reason));
});

test('own structures are not barriers: a ring of extensions still gets ramparts', () => {
    const input = room(() => false);
    const ring = [];
    for (let x = 20; x <= 30; x++) for (const y of [30, 40]) ring.push({type: 'extension', pos: {x, y}});
    for (let y = 31; y <= 39; y++) for (const x of [20, 30]) ring.push({type: 'extension', pos: {x, y}});
    const result = planPerimeter(input, ring, {maxCutTiles: 150});
    assert(!result.reason, result.reason);
    assert(result.cut.length > 0);
    for (const e of ring) assert.strictEqual(exposed(input, new Set(result.cut), e.pos, result.config.buffer), false);
});

for (const name of ['E9S18', 'E9S19', 'E7S18']) {
    test(name + ' fresh: perimeter keeps every planned structure out of ranged reach', () => {
        const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', name + '.fresh.json')));
        const sim = new Simulation(fixture, {mode: 'observe'});
        sim.memory.baseBuilder.perimeter = true;
        sim.reload();
        sim.run();
        const plan = sim.state.plan;
        assert(plan && plan.valid && plan.perimeterPlanned, 'plan with perimeter');
        const cut = plan.entries.filter(e => e.purpose === 'perimeter');
        assert(cut.length > 0 && cut.length <= 60, 'cut ' + cut.length);
        const terrain = Array.from(fixture.terrain, c => Number(c) & 1);
        const blocked = new Set(cut.map(e => e.pos.y * 50 + e.pos.x));
        for (const o of fixture.objects) if (['source', 'mineral', 'controller'].includes(o.type)) blocked.add(o.y * 50 + o.x);
        const input = {terrain};
        for (const e of plan.entries.filter(e => !['road', 'container', 'rampart', 'extractor'].includes(e.type)
            && !(e.type === 'link' && String(e.purpose).startsWith('sourceLink')))) {
            assert.strictEqual(exposed(input, blocked, e.pos, 3), false, e.type + ' exposed at ' + JSON.stringify(e.pos));
        }
    });
}

test('perimeter ramparts are placed only when enabled and from RCL 5', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', 'E9S18.fresh.json')));
    const sim = new Simulation(fixture, {mode: 'place'});
    sim.memory.baseBuilder.perimeter = true;
    sim.reload();
    const perimeterAttempts = () => sim.attempts.filter(a => a.type === 'rampart'
        && sim.state.plan.entries.some(e => e.purpose === 'perimeter' && e.pos.x === a.x && e.pos.y === a.y)).length;
    sim.level = 4;
    for (let i = 0; i < 400; i++) { sim.run(); sim.finishTick(); }
    assert.strictEqual(perimeterAttempts(), 0, 'none at RCL4');
    sim.level = 5;
    for (let i = 0; i < 400; i++) { sim.run(); sim.finishTick(); }
    assert(perimeterAttempts() > 0, 'placed at RCL5');
    const before = perimeterAttempts();
    sim.memory.baseBuilder.perimeter = false;
    sim.reload();
    for (let i = 0; i < 200; i++) { sim.run(); sim.finishTick(); }
    assert.strictEqual(perimeterAttempts(), before, 'no more after disabling');
});
console.log('PASS: ' + passed + ' base-builder perimeter tests');
