'use strict';
// CPU optimizations: seated Slinker fast path, hauler idle sleep, one-room moves for
// home-room roles. Plain node with small mocks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const src = name => fs.readFileSync(path.join(root, name + '.js'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
const C = {RESOURCE_ENERGY: 'energy', WORK: 'work', HARVEST_POWER: 2, OK: 0, ERR_NOT_IN_RANGE: -9};

function load(name, sandbox, requires = {}) {
    const s = Object.assign({module: {exports: {}}, console}, C, sandbox);
    s.require = n => { if (requires[n]) return requires[n]; throw new Error('unexpected require ' + n); };
    vm.runInNewContext(src(name), s, {filename: name + '.js'});
    return s.module.exports;
}
function store(energy, capacity) {
    return {getUsedCapacity: () => energy, getFreeCapacity: () => capacity - energy, energy};
}

// --- Slinker fast path ----------------------------------------------------------
function slinkerWorld({sourceEnergy = 3000, carried = 0, linkUsed = 0, cooldown = 0, onSeat = true, until = 2000} = {}) {
    const calls = [];
    const source = {id: 'src', energy: sourceEnergy};
    const link = {id: 'link', cooldown, store: store(linkUsed, 800), transferEnergy: (t, a) => { calls.push(['link', t.id, a]); return 0; }};
    const receiver = {id: 'recv', store: store(0, 800)};
    const objects = {src: source, link, recv: receiver};
    const creep = {name: 'S', memory: {role: 'Slinker', fast: {sourceId: 'src', linkId: 'link', receiverId: 'recv',
        x: 10, y: 10, until, harvestPerTick: 20}}, pos: {x: onSeat ? 10 : 11, y: 10}, store: store(carried, 100),
        harvest: s => { calls.push(['harvest', s.id]); return 0; },
        transfer: (t, r) => { calls.push(['transfer', t.id]); return 0; }};
    const linker = load('role.linker', {Game: {time: 1000, getObjectById: id => objects[id]}},
        {'energy.fallback': {}, 'source.link': {}});
    return {creep, calls, linker};
}

test('a seated Slinker only harvests, hands over full loads and fires the link', () => {
    let w = slinkerWorld({carried: 0});
    w.linker.run(w.creep);
    assert.deepStrictEqual(w.calls, [['harvest', 'src']]);
    w = slinkerWorld({carried: 90, linkUsed: 790});
    w.linker.run(w.creep);
    assert.deepStrictEqual(w.calls, [['transfer', 'link'], ['harvest', 'src'], ['link', 'recv', 790]]);
    w = slinkerWorld({sourceEnergy: 0, carried: 40});
    w.linker.run(w.creep);
    assert.deepStrictEqual(w.calls, [], 'an empty source and a part load: nothing to do');
    w = slinkerWorld({linkUsed: 790, cooldown: 3});
    w.linker.run(w.creep);
    assert.deepStrictEqual(w.calls, [['harvest', 'src']], 'a cooling link is not fired');
});

test('the fast path steps aside when the cache is stale or the creep is off its seat', () => {
    for (const opts of [{onSeat: false}, {until: 999}]) {
        const w = slinkerWorld(opts);
        assert.throws(() => w.linker.run(w.creep), /./, 'falls through to the full lookup path');
        assert.deepStrictEqual(w.calls, []);
    }
});

// --- creep.idle ----------------------------------------------------------------
function idleWorld() {
    const game = {time: 100};
    const moveStore = {tick: -1, dirs: {}};
    const idle = load('creep.idle', {Game: game, Creep: {prototype: {__trafficMoveStore: moveStore}}});
    const creep = {name: 'L', memory: {}, fatigue: 0, pos: {x: 5, y: 5, roomName: 'E1S1'}, store: store(0, 100),
        room: {memory: {}}};
    return {game, moveStore, idle, creep};
}

test('a hauler that stands still with the same load sleeps, then wakes', () => {
    const w = idleWorld();
    for (let i = 0; i < 4; i++) { assert.strictEqual(w.idle.sleeping(w.creep), false); w.idle.record(w.creep); w.game.time++; }
    assert.strictEqual(w.idle.sleeping(w.creep), true, 'three still ticks after the first: asleep');
    w.game.time += w.idle.IDLE_SLEEP;
    assert.strictEqual(w.idle.sleeping(w.creep), false, 'awake again after the sleep');
});

test('moving, changing load or hostiles in the room keep a hauler awake', () => {
    let w = idleWorld();
    for (let i = 0; i < 6; i++) {
        w.moveStore.tick = w.game.time; w.moveStore.dirs = {L: 3};
        w.idle.record(w.creep); w.game.time++;
        assert.strictEqual(w.idle.sleeping(w.creep), false);
    }
    w = idleWorld();
    for (let i = 0; i < 6; i++) { w.creep.store = store(i * 10, 100); w.idle.record(w.creep); w.game.time++; }
    assert.strictEqual(w.idle.sleeping(w.creep), false);
    w = idleWorld();
    for (let i = 0; i < 4; i++) { w.idle.record(w.creep); w.game.time++; }
    w.creep.room.memory = {hostileCount: 1, hostileLastSeen: w.game.time - 1};
    assert.strictEqual(w.idle.sleeping(w.creep), false, 'hostiles wake it');
});

// --- movement: one-room limit ----------------------------------------------------
test('home-room roles path inside their room; others are untouched', () => {
    const seen = [];
    const proto = {moveTo: function(target, opts) { seen.push(opts); return 0; }};
    const sandbox = {Memory: {}, global: {}, Creep: {prototype: proto}};
    sandbox.global = sandbox;
    const movement = load('movement', sandbox);
    movement.install();
    const mk = role => Object.assign(Object.create(proto), {memory: {role}, room: {name: 'E1S1'}});
    const here = {pos: {x: 10, y: 10, roomName: 'E1S1'}}, there = {pos: {x: 10, y: 10, roomName: 'E2S1'}};
    proto.moveTo.call(mk('lorry'), here, {reusePath: 10});
    proto.moveTo.call(mk('lorry'), there, {reusePath: 10});
    proto.moveTo.call(mk('remoteLorry'), here, {reusePath: 10});
    proto.moveTo.call(mk('upgrader'), here, {maxRooms: 3});
    assert.deepStrictEqual(JSON.parse(JSON.stringify(seen)),
        [{reusePath: 10, maxRooms: 1}, {reusePath: 10}, {reusePath: 10}, {maxRooms: 3}]);
});

console.log('PASS: ' + passed + ' cpu optimization tests');
