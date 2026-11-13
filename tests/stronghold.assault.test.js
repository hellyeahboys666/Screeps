'use strict';
// Stronghold assault: sector scan, assessment per level, quad launch/targeting/stop
// lifecycle, looter requests and the looter role. Plain node with a mocked game.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const managerSource = fs.readFileSync(path.join(root, 'manager.strongholds.js'), 'utf8');
const looterSource = fs.readFileSync(path.join(root, 'role.looter.js'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }

const C = {
    FIND_HOSTILE_STRUCTURES: 'hostileStructures', FIND_HOSTILE_CREEPS: 'hostileCreeps', FIND_STRUCTURES: 'structures',
    FIND_MY_STRUCTURES: 'myStructures', FIND_RUINS: 'ruins', FIND_TOMBSTONES: 'tombstones',
    FIND_DROPPED_RESOURCES: 'dropped', FIND_MY_SPAWNS: 'mySpawns', LOOK_STRUCTURES: 'structure',
    STRUCTURE_INVADER_CORE: 'invaderCore', STRUCTURE_RAMPART: 'rampart', STRUCTURE_TOWER: 'tower',
    STRUCTURE_CONTAINER: 'container', STRUCTURE_OBSERVER: 'observer', STRUCTURE_LAB: 'lab',
    EFFECT_INVULNERABILITY: 1001, EFFECT_COLLAPSE_TIMER: 1002,
    ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', WORK: 'work', CARRY: 'carry', MOVE: 'move', HEAL: 'heal',
    OK: 0, ERR_NOT_IN_RANGE: -9,
    BOOSTS: {attack: {UH2O: {attack: 2}, XUH2O: {attack: 4}}, ranged_attack: {KHO2: {rangedAttack: 2}},
        work: {XLH2O: {repair: 2}}}
};

function pos(x, y, roomName) {
    return {x, y, roomName, isEqualTo: p => p.x === x && p.y === y,
        lookFor: () => [], getRangeTo: p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y))};
}
const FIND_KIND = {hostileStructures: o => o.hostile && o.structureType, hostileCreeps: o => o.hostile && o.body,
    structures: o => !!o.structureType, myStructures: o => o.my && o.structureType, ruins: o => o.kind === 'ruin',
    tombstones: o => o.kind === 'tombstone', dropped: o => o.kind === 'dropped', mySpawns: o => o.my && o.structureType === 'spawn'};
function makeRoom(name, objects, extra = {}) {
    const room = Object.assign({name, memory: {}}, extra);
    for (const o of objects) { o.pos = o.pos || pos(o.x, o.y, name); o.room = room; }
    room.objects = objects;
    room.find = (kind, opts) => objects.filter(o => FIND_KIND[kind](o) && (!opts || !opts.filter || opts.filter(o)));
    room.lookForAt = (look, x, y) => objects.filter(o => o.structureType && o.pos.x === x && o.pos.y === y);
    for (const o of objects) o.pos.lookFor = () => room.lookForAt('structure', o.pos.x, o.pos.y);
    return room;
}
const invader = {username: 'Invader'};
const rampart = (id, x, y, hits) => ({id, structureType: 'rampart', hostile: true, owner: invader, x, y, hits});
function core(level, x = 20, y = 20, effects = []) {
    return {id: 'core', structureType: 'invaderCore', hostile: true, owner: invader, level, x, y, hits: 100000, effects};
}
function home(name, opts = {}) {
    const boosts = opts.boosts === false ? {} : {XGHO2: 2000, XKHO2: 2000, XLHO2: 2000};
    return makeRoom(name, [
        {id: 'obs-' + name, structureType: 'observer', my: true, x: 30, y: 30, observeRoom: r => { (opts.observed || []).push(r); return 0; }},
        {id: 'spawn-' + name, structureType: 'spawn', my: true, x: 25, y: 25}
    ], {controller: {my: true, level: opts.level || 8}, storage: {store: boosts}, terminal: {store: {}}});
}
function load(rooms, time = 1000) {
    const memory = {};
    const game = {time, rooms: {}, creeps: {}, spawns: {}, getObjectById: () => null,
        map: {getRoomLinearDistance: (a, b) => {
            const p = n => { const m = /^[WE](\d+)[NS](\d+)$/.exec(n); return [Number(m[1]), Number(m[2])]; };
            const [ax, ay] = p(a), [bx, by] = p(b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
        }}};
    for (const r of rooms) game.rooms[r.name] = r;
    const sandbox = Object.assign({module: {exports: {}}, Game: game, Memory: memory, console}, C);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(managerSource, sandbox, {filename: 'manager.strongholds.js'});
    return {api: sandbox.module.exports, Game: game, Memory: memory};
}
const cfg = {enabled: true, maxLevel: 3, lootContainers: true, maxSquads: 2};

test('the scan covers the 3x3 middle of each sector', () => {
    const {api} = load([]);
    assert.deepStrictEqual(Array.from(api.sectorCenterRooms('E9S18')).sort(),
        ['E4S14', 'E4S15', 'E4S16', 'E5S14', 'E5S15', 'E5S16', 'E6S14', 'E6S15', 'E6S16']);
    assert(api.sectorCenterRooms('W3N7').includes('W5N5') && api.sectorCenterRooms('W3N7').includes('W4N6'));
    assert.deepStrictEqual(Array.from(api.sectorCenterRooms('nonsense')), []);
});

test('levels 1-3 are beatable by a boosted quad; 4 and 5 are not', () => {
    const {api} = load([]);
    for (const level of [1, 2, 3]) {
        const v = api.assess({level, coreHits: 100000, coreRampartHits: [0, 1e5, 2e5, 5e5][level], room: 'E6S15'},
            5000, cfg, 'E9S18');
        assert.strictEqual(v.verdict, 'engage', level + ': ' + v.reason);
    }
    const all = Object.assign({}, cfg, {maxLevel: 5});
    assert.strictEqual(api.assess({level: 4, coreRampartHits: 1e6}, 5000, cfg, 'E9S18').verdict, 'tooStrong');
    assert.match(api.assess({level: 4, coreRampartHits: 1e6}, 5000, all, 'E9S18').reason, /^damage/);
    assert.match(api.assess({level: 5, coreRampartHits: 2e6}, 5000, all, 'E9S18').reason, /^damage/);
});

test('timing, boosts and fortifiers gate the attack', () => {
    const {api} = load([]);
    const base = {level: 2, coreRampartHits: 200000, coreHits: 100000};
    assert.match(api.assess(Object.assign({}, base, {deployUntil: 6000}), 5000, cfg, 'E9S18').reason, /^deploying/);
    assert.strictEqual(api.assess(Object.assign({}, base, {deployUntil: 5200}), 5000, cfg, 'E9S18').verdict, 'engage',
        'launch shortly before the shield drops');
    assert.strictEqual(api.assess(Object.assign({}, base, {collapseAt: 6000}), 5000, cfg, 'E9S18').reason, 'collapsingSoon');
    assert.strictEqual(api.assess(base, 5000, cfg, null).reason, 'noBoostRoomInRange');
    assert.match(api.assess(Object.assign({}, base, {defenderRepair: 3000}), 5000, cfg, 'E9S18').reason, /^fortifier/);
    assert.strictEqual(api.assess(Object.assign({}, base, {coreDead: true}), 5000, cfg, null).verdict, 'loot');
});

function strongholdRoom(level, extra = []) {
    return makeRoom('E6S15', [core(level), rampart('coreRampart', 20, 20, 200000),
        {id: 'tower1', structureType: 'tower', hostile: true, owner: invader, x: 21, y: 21}].concat(extra),
        {controller: undefined});
}

test('an engageable stronghold launches a boosted quad aimed at the core rampart', () => {
    const room = strongholdRoom(2);
    const {api, Memory} = load([home('E9S18'), room]);
    api.run();
    const record = Memory.strongholds.E6S15;
    assert.strictEqual(record.verdict, 'engage', record.reason);
    assert.strictEqual(record.assault, 'active');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Memory.spawnQuad)), {squad: 'sh_E6S15', targetRoom: 'E6S15',
        retreatRoom: 'E9S18', spawnRooms: ['E9S18'], boostMode: 'required', enabled: true, stronghold: true});
    assert.strictEqual(Memory.quads.sh_E6S15.targetId, 'coreRampart');
});

test('a quad you set up yourself is never overridden', () => {
    const {api, Memory} = load([home('E9S18'), strongholdRoom(1)]);
    Memory.spawnQuad = {squad: 'quad1', targetRoom: 'E1S1'};
    api.run();
    assert.strictEqual(Memory.spawnQuad.squad, 'quad1');
    assert.notStrictEqual(Memory.strongholds.E6S15.assault, 'active');
});

test('without boosts nothing launches; disabled stops a running assault', () => {
    let env = load([home('E9S18', {boosts: false}), strongholdRoom(1)]);
    env.api.run();
    assert.strictEqual(env.Memory.spawnQuad, undefined);
    assert.strictEqual(env.Memory.strongholds.E6S15.reason, 'noBoostRoomInRange');
    env = load([home('E9S18'), strongholdRoom(1)]);
    env.api.run();
    env.Memory.strongholdAssault = {enabled: false};
    env.Game.time++;
    env.api.run();
    assert.strictEqual(env.Memory.spawnQuad, undefined);
    assert.strictEqual(env.Memory.strongholds.E6S15.assault, 'disabled');
});

test('armed defenders clear the target so the quad fights them first', () => {
    const defender = {id: 'd1', hostile: true, owner: invader, x: 25, y: 25, body: Array(15).fill({type: 'attack', hits: 100})};
    const {api, Memory, Game} = load([home('E9S18'), strongholdRoom(2, [defender])]);
    api.run();
    Game.creeps.q1 = {name: 'q1', memory: {role: 'quad', squad: 'sh_E6S15'}};
    Game.time++;
    api.run();
    assert.strictEqual(Memory.quads.sh_E6S15.targetId, undefined);
    assert.strictEqual(Memory.strongholds.E6S15.defenderDamage, 450);
});

test('after the core dies the quad opens loot containers, then stands down', () => {
    const room = strongholdRoom(2);
    const env = load([home('E9S18'), room]);
    env.api.run();
    env.Game.creeps.q1 = {name: 'q1', memory: {role: 'quad', squad: 'sh_E6S15'}};
    // Core destroyed: a ruin with loot (open) and a container still under a rampart.
    room.objects.length = 0;
    room.objects.push({id: 'ruin', kind: 'ruin', x: 20, y: 20, store: {getUsedCapacity: () => 5000, wire: 5000}},
        {id: 'box', structureType: 'container', x: 21, y: 20, store: {getUsedCapacity: () => 4000, metal: 4000}},
        rampart('boxRampart', 21, 20, 150000));
    for (const o of room.objects) { o.pos = pos(o.x, o.y, 'E6S15'); o.room = room; o.pos.lookFor = () => room.lookForAt('structure', o.x, o.y); }
    env.Game.time++;
    env.api.run();
    const record = env.Memory.strongholds.E6S15;
    assert.strictEqual(record.coreDead, true);
    assert.strictEqual(env.Memory.quads.sh_E6S15.targetId, 'boxRampart');
    // The rampart falls: nothing left to open, the request is withdrawn.
    room.objects.splice(room.objects.findIndex(o => o.id === 'boxRampart'), 1);
    env.Game.time++;
    env.api.run();
    assert.strictEqual(env.Memory.spawnQuad, undefined);
    assert.strictEqual(record.assault, 'won');
});

test('a squad budget spent without killing the core ends as failed', () => {
    const env = load([home('E9S18'), strongholdRoom(3)]);
    env.api.run();
    env.Memory.strongholds.E6S15.squadMembers = Array.from({length: 8}, (_, i) => 'old' + i);
    env.Game.time++;
    env.api.run();
    assert.strictEqual(env.Memory.strongholds.E6S15.assault, 'failed');
    assert.strictEqual(env.Memory.spawnQuad, undefined);
});

test('observers scan the sector one room at a time', () => {
    const observed = [];
    const env = load([home('E9S18', {observed})], 5000);
    env.api.run();
    assert.strictEqual(observed.length, 1);
    env.Game.time += 50; env.api.run();
    assert.strictEqual(observed.length, 1, 'waits for the scan interval');
    env.Game.time += 50; env.api.run();
    assert.strictEqual(observed.length, 2);
    assert.notStrictEqual(observed[0], observed[1]);
});

test('looters are requested from the home room only while open loot remains', () => {
    const env = load([home('E9S18')]);
    env.Memory.strongholds = {E6S15: {room: 'E6S15', coreDead: true, home: 'E9S18', seen: 1000,
        loot: [{id: 'ruin', open: true, amount: 5000}]}};
    const spawn = {room: {name: 'E9S18'}};
    const req = env.api.getLooterRequest(spawn);
    assert.strictEqual(req.targetRoom, 'E6S15');
    assert.strictEqual(env.api.getLooterRequest({room: {name: 'E9S19'}}), undefined);
    env.Game.creeps.a = {memory: {role: 'looter', target: 'E6S15'}};
    env.Game.creeps.b = {memory: {role: 'looter', target: 'E6S15'}};
    assert.strictEqual(env.api.getLooterRequest(spawn), undefined, 'two looters at most');
    env.Memory.strongholds.E6S15.loot[0].open = false;
    delete env.Game.creeps.a; delete env.Game.creeps.b;
    assert.strictEqual(env.api.getLooterRequest(spawn), undefined, 'nothing reachable yet');
});

// --- role.looter ------------------------------------------------------------------
function loadLooter(rooms) {
    const game = {time: 1, rooms: {}, getObjectById: () => null};
    for (const r of rooms) game.rooms[r.name] = r;
    function RoomPosition(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    const sandbox = Object.assign({module: {exports: {}}, Game: game, RoomPosition, Memory: {}}, C);
    vm.runInNewContext(looterSource, sandbox, {filename: 'role.looter.js'});
    return sandbox.module.exports;
}
function makeStore(contents, capacity) {
    const store = Object.assign({}, contents);
    Object.defineProperty(store, 'getUsedCapacity', {value: () => Object.values(contents).reduce((a, b) => a + b, 0)});
    Object.defineProperty(store, 'getFreeCapacity', {value: () => capacity - store.getUsedCapacity()});
    return store;
}
function looterCreep(room, contents, extra = {}) {
    const calls = [];
    return Object.assign({name: 'L', room, pos: Object.assign(pos(25, 25, room.name), {findClosestByRange: list => list[0]}),
        memory: {role: 'looter', home: 'E9S18', target: 'E6S15', returnTicks: 200}, ticksToLive: 1000,
        store: makeStore(contents, 1250), calls,
        withdraw: (t, type) => { calls.push(['withdraw', t.id, type]); return 0; },
        transfer: (t, type) => { calls.push(['transfer', t.id, type]); return 0; },
        pickup: t => { calls.push(['pickup', t.id]); return 0; },
        moveTo: p => { calls.push(['move', p.roomName || p.x]); return 0; }}, extra);
}

test('the looter takes from the open ruin and skips the container under a rampart', () => {
    const room = makeRoom('E6S15', [
        {id: 'box', structureType: 'container', x: 21, y: 20, store: makeStore({metal: 4000}, 2000)},
        rampart('boxRampart', 21, 20, 1000),
        {id: 'ruin', kind: 'ruin', x: 20, y: 20, store: makeStore({wire: 500}, 0)}]);
    const looter = loadLooter([room]);
    const creep = looterCreep(room, {});
    looter.run(creep);
    assert.deepStrictEqual(creep.calls[0], ['withdraw', 'ruin', 'wire']);
});

test('a full looter goes home and unloads into the terminal', () => {
    const homeRoom = makeRoom('E9S18', [], {terminal: {id: 'term', pos: pos(26, 26, 'E9S18'), store: makeStore({}, 300000)}});
    const looter = loadLooter([homeRoom]);
    const creep = looterCreep(homeRoom, {wire: 1250});
    looter.run(creep);
    assert.strictEqual(creep.memory.returning, true);
    assert.deepStrictEqual(creep.calls[0], ['transfer', 'term', 'wire']);
});

console.log('PASS: ' + passed + ' stronghold assault tests');
