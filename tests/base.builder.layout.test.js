'use strict';
// Layout-quality and access regressions for the base planner. Plain node, no live API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const access = require(path.join(ROOT, 'base.builder.access.js'));
const {Simulation} = require('./helpers/base.builder.sim.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function emptyInput(anchor) {
    return {anchor: {id: 'a', pos: anchor}, controller: {pos: {x: 40, y: 40}}, terrain: new Array(2500).fill(0),
        structures: [{type: 'spawn', pos: anchor, my: true}], sites: [], spawns: [{type: 'spawn', pos: anchor}],
        sources: [], minerals: []};
}
function wallColumn(input, x) { for (let y = 0; y < 50; y++) input.terrain[y * 50 + x] = 1; }

test('flood never bridges two pockets through the spawn tile', () => {
    // A wall column at x=10 with the spawn sitting in its only gap (10,20).
    const input = emptyInput({x: 10, y: 20});
    wallColumn(input, 10);
    input.terrain[20 * 50 + 10] = 0;
    const storage = {type: 'storage', pos: {x: 14, y: 20}};
    const reached = access.flood(input, access.obstacles(input, [storage]), storage.pos);
    assert.strictEqual(reached[20 * 50 + 12], 1, 'storage side reached');
    assert.strictEqual(reached[20 * 50 + 8], 0, 'far side of the spawn is not the base');
    // A source on the far side is therefore not seated.
    input.sources = [{id: 's', pos: {x: 5, y: 20}}];
    assert.strictEqual(access.create(input).check([storage]), 'blockedSourceSeat');
});

test('without a storage the largest spawn-adjacent pocket is the base', () => {
    const input = emptyInput({x: 10, y: 20});
    wallColumn(input, 10);
    input.terrain[20 * 50 + 10] = 0;
    const reached = access.flood(input, access.obstacles(input, []));
    assert.strictEqual(reached[20 * 50 + 30], 1, 'east pocket (38 columns) wins');
    assert.strictEqual(reached[20 * 50 + 5], 0);
});

test('an existing link only protects its own job, not incidental shared seats', () => {
    // Source link at (21,20) for a source at (20,22); a storage at (23,21) also
    // happens to share the seats (22,20) and (22,21) with it. Covering both of
    // those must be allowed: the link's job is the source, which keeps its seats.
    const input = emptyInput({x: 30, y: 30});
    input.sources = [{id: 's', pos: {x: 20, y: 22}}];
    input.structures.push({type: 'link', pos: {x: 21, y: 20}, my: true},
        {type: 'storage', pos: {x: 23, y: 21}, my: true});
    const guard = access.create(input);
    assert.strictEqual(guard.check([{type: 'extension', pos: {x: 22, y: 20}},
        {type: 'extension', pos: {x: 22, y: 21}}]), null);
});

test('walkDistance counts steps around walls, not straight-line range', () => {
    const input = emptyInput({x: 30, y: 30});
    for (let y = 5; y <= 45; y++) input.terrain[y * 50 + 20] = 1; // wall x=20, open at y<5 and y>45
    const dist = access.walkDistance(input, new Set(), {x: 19, y: 25});
    assert.strictEqual(dist[25 * 50 + 18], 0);
    assert(dist[25 * 50 + 21] > 30, 'other side of the wall is a long walk: ' + dist[25 * 50 + 21]);
});

const LIMITS = {extensionMaxWalk: 20, towerMaxWalk: 12};
for (const room of ['E9S18', 'E9S19', 'E7S18']) {
    test(room + ' fresh plan: compact, reachable, policy-sized', () => {
        const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', room + '.fresh.json')));
        const sim = new Simulation(fixture, {mode: 'observe'});
        sim.run();
        const plan = sim.state.plan;
        assert(plan && plan.valid, 'plan generated');
        const count = type => plan.entries.filter(e => e.type === type).length;
        assert.strictEqual(count('lab'), 3, 'labs follow the default cap');
        assert.strictEqual(count('factory'), 0, 'no factory by default');
        assert.strictEqual(count('extension'), 60);
        const terrain = Array.from(fixture.terrain, c => Number(c) & 1);
        const spawn = fixture.objects.find(o => o.type === 'spawn');
        const input = {anchor: {id: spawn._id, pos: {x: spawn.x, y: spawn.y}}, terrain, sites: [],
            structures: [{type: 'spawn', pos: {x: spawn.x, y: spawn.y}, my: true}], spawns: [],
            sources: [], minerals: [], controller: {pos: {x: 0, y: 0}}};
        const built = plan.entries.filter(e => e.type !== 'rampart');
        const storage = built.find(e => e.type === 'storage');
        const dist = access.walkDistance(input, access.obstacles(input, built), storage.pos);
        const walkTo = p => {
            let best = 65535;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
                if (dx || dy) best = Math.min(best, dist[(p.y + dy) * 50 + p.x + dx]);
            return best;
        };
        const ext = built.filter(e => e.type === 'extension').map(e => walkTo(e.pos));
        const towers = built.filter(e => e.type === 'tower').map(e => walkTo(e.pos));
        assert(Math.max(...ext) <= LIMITS.extensionMaxWalk, 'extension walk ' + Math.max(...ext));
        assert(Math.max(...towers) <= LIMITS.towerMaxWalk, 'tower walk ' + Math.max(...towers));
    });
}
test('lab caps of 1 and 2 plan that many labs (boost-only rooms)', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', 'E9S19.fresh.json')));
    for (const cap of [1, 2]) {
        const sim = new Simulation(fixture, {mode: 'observe', roomLimits: {lab: cap}});
        sim.run();
        assert.strictEqual(sim.state.plan.entries.filter(e => e.type === 'lab').length, cap);
    }
});
console.log('PASS: ' + passed + ' base-builder layout tests');
