'use strict';
// Rampart placement: the controller is sealed rather than walled in from afar,
// standing ramparts near the base are reused, and ramparts the wall no longer
// needs are retired only once the planned wall stands. Plain node, no live API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {planPerimeter, planDefense} = require(path.join(__dirname, '..', 'base.builder.defense.js'));
const {C, Simulation, sourceSnapshot} = require('./helpers/base.builder.sim.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const range = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const at = i => ({x: i % 50, y: Math.floor(i / 50)});
const key = p => p.y * 50 + p.x;
function room(wallFn, extra = {}) {
    const terrain = new Array(2500).fill(0);
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (wallFn(x, y)) terrain[y * 50 + x] = 1;
    return Object.assign({eligible: true, anchor: {id: 'a', pos: {x: 25, y: 20}}, controller: {pos: {x: 25, y: 42}},
        terrain, structures: [], sites: [], spawns: [{id: 'a', type: 'spawn', pos: {x: 25, y: 20}, my: true}],
        sources: [], minerals: []}, extra);
}
// Hostile reachability from exits through non-wall tiles not in `blocked`.
function reachable(input, blocked) {
    const seen = new Uint8Array(2500), q = [];
    const open = i => !input.terrain[i] && !blocked.has(i);
    for (let i = 0; i < 2500; i++) {
        const {x, y} = at(i);
        if ((x === 0 || x === 49 || y === 0 || y === 49) && open(i)) { seen[i] = 1; q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
        const {x, y} = at(q[h]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy, n = ny * 50 + nx;
            if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || seen[n] || !open(n)) continue;
            seen[n] = 1; q.push(n);
        }
    }
    return seen;
}
const border = (x, y) => x === 0 || x === 49 || y === 0 || y === 49;

test('a distant controller is sealed on its neighbours, not walled in with the base', () => {
    // Open room (top exit only): the base sits at y=20, the controller far south at y=42.
    const input = room((x, y) => y > 0 && border(x, y));
    const result = planPerimeter(input, [], {});
    assert(!result.reason, result.reason);
    assert.strictEqual(result.config.controller, 'seal');
    const wall = result.wallKeys.map(at);
    // Every wall rampart hugs the base (range 4) or touches the controller (range 1).
    const stray = wall.filter(p => range(p, input.anchor.pos) > 4 && range(p, input.controller.pos) > 1);
    assert.deepStrictEqual(stray, [], 'ramparts away from both the base and the controller');
    assert.strictEqual(result.seal.length, 8, 'all eight open neighbours of the controller');
    const seen = reachable(input, new Set(result.wallKeys));
    for (let i = 0; i < 2500; i++) {
        if (!seen[i]) continue;
        assert(range(at(i), input.anchor.pos) > 3, 'spawn in ranged reach from ' + JSON.stringify(at(i)));
        assert(range(at(i), input.controller.pos) > 1, 'controller reachable from ' + JSON.stringify(at(i)));
    }
});

test('a controller in a dead end needs one seal rampart', () => {
    // The controller at (25,42) sits in a pocket whose only open neighbour is (25,41).
    const pocket = (x, y) => (Math.abs(x - 25) <= 1 && Math.abs(y - 42) <= 1 && !(x === 25 && y === 41))
        || (Math.abs(x - 25) === 2 && y >= 40 && y <= 44) || (y === 44 && Math.abs(x - 25) <= 2);
    const input = room((x, y) => (y > 0 && border(x, y)) || (pocket(x, y) && !(x === 25 && y === 42)));
    const result = planPerimeter(input, [], {});
    assert(!result.reason, result.reason);
    assert.strictEqual(result.config.controller, 'seal');
    assert.deepStrictEqual(result.seal.map(at), [{x: 25, y: 41}]);
});

test('the controller is never buffered like a base structure', () => {
    // Before: the controller (owned, in structures) was protected with a 3-tile buffer,
    // which dragged the wall out to it. Now only its neighbours are guarded.
    const input = room((x, y) => y > 0 && border(x, y));
    input.structures.push({id: 'c', type: 'controller', pos: input.controller.pos, my: true});
    const result = planPerimeter(input, [], {});
    const nearController = result.wallKeys.map(at).filter(p => range(p, input.controller.pos) <= 4);
    assert(nearController.every(p => range(p, input.controller.pos) === 1), JSON.stringify(nearController));
});

test('a standing ring near the base is reused; a far outer line is not part of the wall', () => {
    const input = room((x, y) => y > 0 && border(x, y), {controller: {pos: {x: 25, y: 22}}});
    const ring = [];
    for (let y = 16; y <= 24; y++) for (let x = 21; x <= 29; x++) {
        if (x === 21 || x === 29 || y === 16 || y === 24) ring.push({x, y});
    }
    const outer = [];
    for (let x = 2; x <= 47; x++) outer.push({x, y: 6});
    let n = 0;
    for (const p of ring.concat(outer)) input.structures.push({id: 'r' + (n++), type: 'rampart', my: true, pos: p});
    const result = planPerimeter(input, [], {});
    assert(!result.reason, result.reason);
    assert.strictEqual(result.cut.length, 0, 'nothing new to build');
    const wall = new Set(result.wallKeys);
    assert.strictEqual(wall.size, ring.length);
    assert(ring.every(p => wall.has(key(p))), 'every ring rampart is in the wall');
    assert(outer.every(p => !wall.has(key(p))), 'the outer line is redundant');
});

test('a short new rampart beats a long detour through standing ones', () => {
    // A complete ring except one tile; an old 5-rampart bulge closes it the long way.
    const input = room((x, y) => y > 0 && border(x, y), {controller: {pos: {x: 25, y: 22}}});
    const ring = [];
    for (let y = 16; y <= 24; y++) for (let x = 21; x <= 29; x++) {
        if ((x === 21 || x === 29 || y === 16 || y === 24) && !(x === 25 && y === 24)) ring.push({x, y});
    }
    // Bulge below the gap: (24..26, 25) row and sides, enclosing (25,24).
    const bulge = [{x: 24, y: 25}, {x: 25, y: 25}, {x: 26, y: 25}];
    let n = 0;
    for (const p of ring.concat(bulge)) input.structures.push({id: 'r' + (n++), type: 'rampart', my: true, pos: p});
    const result = planPerimeter(input, [], {});
    assert(!result.reason, result.reason);
    assert.deepStrictEqual(result.cut.map(at), [{x: 25, y: 24}], 'one new rampart in the gap');
    assert(bulge.every(p => !result.wallKeys.includes(key(p))), 'the bulge is no longer needed');
});

test('planDefense emits controllerSeal entries and wallKeys', () => {
    const input = room((x, y) => y > 0 && border(x, y));
    const result = planDefense(input, [], {perimeter: true});
    assert(result.perimeterSupported, JSON.stringify(result.blockers));
    const seals = result.entries.filter(e => e.purpose === 'controllerSeal');
    assert.strictEqual(seals.length, 8);
    assert.strictEqual(result.perimeter.controller, 'seal');
    const wall = new Set(result.wallKeys);
    for (const e of result.entries.filter(e => e.purpose === 'perimeter' || e.purpose === 'controllerSeal')) {
        assert(wall.has(key(e.pos)), 'entry outside wallKeys ' + JSON.stringify(e.pos));
    }
});

// --- Retirement -------------------------------------------------------------------
function retireHarness() {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', 'E9S18.fresh.json')));
    const sim = new Simulation(fixture, {sources: sourceSnapshot(), mode: 'place'});
    sim.memory.baseBuilder.perimeter = true;
    sim.reload();
    const executor = sim.load('base.builder.executor');
    const destroyed = [];
    function rampart(x, y, hits, extra = {}) {
        return Object.assign({id: 'r' + x + '_' + y, structureType: 'rampart', my: true, pos: {x, y},
            hits, hitsMax: 300000000, destroy() { destroyed.push(x + ',' + y); return C.OK; }}, extra);
    }
    function makeRoom(structures, level = 8) {
        return {name: 'E9S18', controller: {my: true, level}, memory: {baseBuilder: {}},
            find: kind => kind === C.FIND_STRUCTURES ? structures : []};
    }
    return {sim, executor, destroyed, rampart, makeRoom};
}
const wallPlan = (keys, entries = []) => ({perimeterPlanned: true, wallKeys: keys, entries});

test('retirement waits until every wall rampart stands with real hits', () => {
    const h = retireHarness();
    const wall = [h.rampart(10, 10, 5000), h.rampart(11, 10, 500000)];
    const old = [h.rampart(30, 3, 2000000)];
    const room = h.makeRoom(wall.concat(old));
    const plan = wallPlan([key({x: 10, y: 10}), key({x: 11, y: 10})]);
    let r = h.executor.retireRedundantRamparts(room, plan, {memory: {rampartTargetHits: 10000000}});
    assert.strictEqual(r.status, 'wallIncomplete');
    assert.strictEqual(room.memory.baseBuilder.redundantRamparts, 1);
    assert.deepStrictEqual(h.destroyed, []);
    wall[0].hits = 150000;
    r = h.executor.retireRedundantRamparts(room, plan, {memory: {rampartTargetHits: 10000000}});
    assert.strictEqual(r.status, 'retired');
    assert.deepStrictEqual(h.destroyed, ['30,3']);
    assert.strictEqual(room.memory.baseBuilder.retiredRamparts, 1);
});

test('a low room target lowers the bar (90% of target)', () => {
    const h = retireHarness();
    const room = h.makeRoom([h.rampart(10, 10, 95000), h.rampart(40, 40, 99000)]);
    const r = h.executor.retireRedundantRamparts(room, wallPlan([key({x: 10, y: 10})]), {memory: {rampartTargetHits: 100000}});
    assert.strictEqual(r.status, 'retired');
    assert.deepStrictEqual(h.destroyed, ['40,40']);
});

test('shields over structures, planned ramparts and walls are never retired; 5 per run', () => {
    const h = retireHarness();
    const wall = h.rampart(10, 10, 200000);
    const shield = h.rampart(20, 20, 200000);
    const ext = {id: 'e', structureType: 'extension', my: true, pos: {x: 20, y: 20}};
    const overContainer = h.rampart(21, 21, 200000);
    const container = {id: 'c', structureType: 'container', pos: {x: 21, y: 21}};
    const planned = h.rampart(22, 22, 200000);
    const onRoad = h.rampart(23, 23, 200000);
    const road = {id: 'rd', structureType: 'road', pos: {x: 23, y: 23}};
    const foreign = h.rampart(24, 24, 200000, {my: false});
    const loose = [];
    for (let x = 30; x < 37; x++) loose.push(h.rampart(x, 5, 200000));
    const room = h.makeRoom([wall, shield, ext, overContainer, container, planned, onRoad, road, foreign].concat(loose));
    const plan = wallPlan([key({x: 10, y: 10})], [{type: 'rampart', purpose: 'vitalOverlay', pos: {x: 22, y: 22}}]);
    const r = h.executor.retireRedundantRamparts(room, plan, null);
    assert.strictEqual(r.count, 5);
    assert.strictEqual(room.memory.baseBuilder.redundantRamparts, 3, '8 candidates, 5 retired');
    assert(!h.destroyed.includes('20,20') && !h.destroyed.includes('21,21') && !h.destroyed.includes('22,22')
        && !h.destroyed.includes('24,24') && !h.destroyed.includes('10,10'), h.destroyed.join(' '));
});

test('retirement is off by flag, without a wall plan, or below the perimeter RCL', () => {
    const h = retireHarness();
    const structures = [h.rampart(10, 10, 500000), h.rampart(40, 40, 500000)];
    const plan = wallPlan([key({x: 10, y: 10})]);
    let room = h.makeRoom(structures);
    room.memory.baseBuilder.retireRamparts = false;
    assert.strictEqual(h.executor.retireRedundantRamparts(room, plan, null).status, 'off');
    room = h.makeRoom(structures);
    assert.strictEqual(h.executor.retireRedundantRamparts(room, {perimeterPlanned: true, entries: []}, null).status, 'noWall');
    room = h.makeRoom(structures, 4);
    assert.strictEqual(h.executor.retireRedundantRamparts(room, plan, null).status, 'noWall');
    assert.deepStrictEqual(h.destroyed, []);
});

test('a stored plan from the old wall planner is re-planned in place', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/base-builder', 'E9S18.fresh.json')));
    const sim = new Simulation(fixture, {sources: sourceSnapshot(), mode: 'place'});
    sim.memory.baseBuilder.perimeter = true;
    sim.reload();
    sim.level = 5;
    sim.run(); sim.finishTick();
    assert(sim.state.plan && sim.state.plan.perimeterVersion >= 2, 'new plans carry the perimeter version');
    assert(Array.isArray(sim.state.plan.wallKeys) && sim.state.plan.wallKeys.length > 0, 'plan keeps wallKeys');
    delete sim.state.plan.perimeterVersion;
    sim.run();
    assert.strictEqual(sim.state.replannedForPerimeter, sim.tick);
    assert(sim.state.plan.perimeterVersion >= 2);
    assert.strictEqual(sim.destroyCalls.length, 0, 'placement never destroys');
});

console.log('PASS: ' + passed + ' rampart placement tests');
