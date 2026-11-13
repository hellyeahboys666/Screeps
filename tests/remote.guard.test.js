'use strict';
// Remote guards: threat sizing against the engine's real Invader raid bodies, which
// rooms are protected, spawn requests, and the guard's fight/escort/retire loop.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = name => fs.readFileSync(path.join(root, name + '.js'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }

const C = {
    ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', HEAL: 'heal', WORK: 'work', TOUGH: 'tough', MOVE: 'move',
    CARRY: 'carry', CLAIM: 'claim', FIND_HOSTILE_CREEPS: 'hostileCreeps', FIND_MY_CREEPS: 'myCreeps',
    FIND_MY_SPAWNS: 'mySpawns', OK: 0, ERR_NOT_IN_RANGE: -9, TOP: 1,
    ATTACK_POWER: 30, RANGED_ATTACK_POWER: 10, HEAL_POWER: 12, RANGED_HEAL_POWER: 4,
    BOOSTS: {
        attack: {UH: {attack: 2}, XUH2O: {attack: 4}}, ranged_attack: {KO: {rangedAttack: 2, rangedMassAttack: 2}, XKHO2: {rangedAttack: 4, rangedMassAttack: 4}},
        heal: {LO: {heal: 2, rangedHeal: 2}, XLHO2: {heal: 4, rangedHeal: 4}}, tough: {GO: {damage: 0.5}, XGHO2: {damage: 0.3}}
    }
};
// Raid bodies from screeps/backend-local lib/cronjobs.js createCreep().
const RAID = {
    smallMelee: 'tough tough move move move move ranged_attack work attack move',
    smallRanged: 'tough tough move move move move ranged_attack ranged_attack ranged_attack move',
    smallHealer: 'move move move move heal heal heal heal heal move',
    bigMelee: ('tough '.repeat(16) + 'move '.repeat(24) + 'ranged_attack '.repeat(3) + 'work '.repeat(4) + 'attack attack move').trim(),
    bigRanged: ('tough '.repeat(6) + 'move '.repeat(24) + 'ranged_attack '.repeat(18) + 'work move').trim(),
    bigHealer: ('move '.repeat(24) + 'heal '.repeat(25) + 'move').trim()
};
const T1 = {heal: 'LO', ranged_attack: 'KO', attack: 'UH', tough: 'GO', work: 'ZH'};
let ids = 0;
function invader(kind, x = 25, y = 25, room = 'E9S17', boosted = false, owner = 'Invader') {
    const body = RAID[kind].split(' ').map(type => ({type, hits: 100, boost: boosted ? T1[type] : undefined}));
    return makeCreep({id: kind + (++ids), owner: {username: owner}, body, x, y, room});
}
function makeCreep(o) {
    const c = Object.assign({hitsMax: o.body.length * 100}, o);
    c.hits = c.hits === undefined ? c.hitsMax : c.hits;
    c.getActiveBodyparts = t => c.body.filter(p => p.type === t && p.hits > 0).length;
    c.pos = makePos(o.x, o.y, o.room);
    return c;
}
function makePos(x, y, roomName) {
    return {x, y, roomName,
        getRangeTo: (a, b) => { const p = typeof a === 'number' ? {x: a, y: b} : (a.pos || a); return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)); },
        isNearTo: a => { const p = a.pos || a; return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1; },
        getDirectionTo: () => 1,
        findInRange: () => [], findClosestByRange: list => list[0]};
}

function sandbox(extra) {
    const s = Object.assign({console, module: {exports: {}}, Memory: {}, Game: {time: 100, creeps: {}, rooms: {}, spawns: {},
        map: {getRoomLinearDistance: (a, b) => {
            const p = n => /^[WE](\d+)[NS](\d+)$/.exec(n).slice(1).map(Number);
            const [ax, ay] = p(a), [bx, by] = p(b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
        }}}}, C, extra || {});
    const modules = {};
    s.require = name => {
        if (modules[name]) return modules[name].exports;
        const mod = modules[name] = {exports: {}};
        vm.runInNewContext('(function(module, exports, require){' + src(name) + '\n})', s)(mod, mod.exports, s.require);
        return mod.exports;
    };
    return s;
}
function room(name, objects, extra = {}) {
    return Object.assign({name, objects, memory: {},
        find: (kind, opts) => objects.filter(o => o.findKind === kind || (kind === 'hostileCreeps' && o.owner && !o.my))
            .filter(o => !opts || !opts.filter || opts.filter(o))}, extra);
}

test('guard sizing beats typical raids and refuses ones it would lose', () => {
    const s = sandbox();
    const g = s.require('manager.remoteGuard');
    const full = g.guardStats(12900, 1);
    assert.deepStrictEqual([full.blocks, full.dps, full.heal, full.cost], [6, 180, 72, 5400]);
    const need = kinds => g.guardsNeeded(g.measure(kinds.map(k => invader(k[0], 25, 25, 'E9S17', k[1]))), full, 4);
    assert.strictEqual(need([['smallMelee']]), 1);
    assert.strictEqual(need([['smallRanged'], ['smallHealer']]), 1);
    // T1-boosted trio heals 120/tick: two guards keep the margin.
    assert.strictEqual(need([['smallMelee', true], ['smallRanged', true], ['smallHealer', true]]), 2);
    assert.strictEqual(need([['bigMelee'], ['bigHealer']]), 3);
    assert.strictEqual(need([['bigMelee', true], ['bigRanged', true], ['bigRanged', true], ['bigHealer', true], ['bigHealer', true]]),
        Infinity, 'a boosted five-creep raid out-heals four unboosted guards');
    const boosted = g.guardStats(12900, 4);
    assert.strictEqual(g.guardsNeeded(g.measure(['bigMelee', 'bigRanged', 'bigRanged', 'bigHealer', 'bigHealer']
        .map(k => invader(k, 25, 25, 'E9S17', true))), boosted, 4), 3);
    assert.strictEqual(g.guardsNeeded({count: 0}, full, 4), 0);
    assert.strictEqual(g.guardsNeeded({count: 1, heal: 0, hits: 1000, damage: 40}, g.guardStats(500, 1), 4), Infinity,
        'a room that cannot afford one block sends none');
});

function world(opts = {}) {
    const s = sandbox();
    const home = room('E9S18', [{findKind: 'mySpawns', id: 'spawn'}], {controller: {my: true}, energyCapacityAvailable: 12900,
        storage: {store: opts.boosts ? {XKHO2: 5000, XLHO2: 5000} : {}}, terminal: {store: {}}});
    const remote = room('E9S17', opts.hostiles || []);
    s.Game.rooms = {E9S18: home, E9S17: remote};
    s.Game.creeps.h1 = {name: 'h1', room: remote, memory: {role: 'longDistanceHarvester', target: 'E9S17'}};
    if (opts.memory) s.Memory.remoteGuard = opts.memory;
    return {s, g: s.require('manager.remoteGuard'), home, remote};
}

test('an Invader in a remote room asks the nearest strong room for a guard', () => {
    const w = world({hostiles: [invader('smallMelee')]});
    w.g.run();
    const r = w.s.Memory.remoteGuardRooms.E9S17;
    assert.deepStrictEqual([r.verdict, r.needed, r.home, r.boosted], ['defend', 1, 'E9S18', false]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.g.getSpawnRequest({room: w.home}))),
        {room: 'E9S17', blocks: 6, cost: 5400, boosted: false});
    w.s.Game.creeps.g1 = {name: 'g1', memory: {role: 'remoteGuard', target: 'E9S17'}};
    assert.strictEqual(w.g.getSpawnRequest({room: w.home}), undefined, 'already covered');
    assert.strictEqual(w.g.getSpawnRequest({room: {name: 'E9S19'}}), undefined, 'only the chosen home spawns it');
});

test('a raid unboosted guards would lose uses boosted guards when the home has boosts', () => {
    const raid = () => ['bigMelee', 'bigRanged', 'bigRanged', 'bigHealer', 'bigHealer'].map(k => invader(k, 25, 25, 'E9S17', true));
    let w = world({hostiles: raid()});
    w.g.run();
    assert.strictEqual(w.s.Memory.remoteGuardRooms.E9S17.verdict, 'tooStrong');
    assert.strictEqual(w.g.getSpawnRequest({room: w.home}), undefined, 'never feed guards to a lost fight');
    w = world({hostiles: raid(), boosts: true});
    w.g.run();
    const r = w.s.Memory.remoteGuardRooms.E9S17;
    assert.deepStrictEqual([r.verdict, r.needed, r.boosted], ['defend', 3, true]);
    assert.strictEqual(w.g.getSpawnRequest({room: w.home}).boosted, true);
});

test('players, source keepers and keeper rooms are left alone by default', () => {
    let w = world({hostiles: [invader('smallMelee', 25, 25, 'E9S17', false, 'SomePlayer'),
        invader('smallMelee', 10, 10, 'E9S17', false, 'Source Keeper')]});
    w.g.run();
    assert.strictEqual(w.s.Memory.remoteGuardRooms.E9S17, undefined);
    w = world({hostiles: [invader('smallMelee', 25, 25, 'E9S17', false, 'SomePlayer')], memory: {includePlayers: true}});
    w.g.run();
    assert.strictEqual(w.s.Memory.remoteGuardRooms.E9S17.verdict, 'defend');
    assert.strictEqual(w.g.isKeeperRoom('E5S15'), true);
    assert.strictEqual(w.g.isKeeperRoom('E9S17'), false);
});

test('a cleared room drops the threat; disabled sends nothing', () => {
    const w = world({hostiles: [invader('smallMelee')]});
    w.g.run();
    w.remote.objects.length = 0;
    w.s.Game.time++;
    w.g.run();
    assert.strictEqual(w.s.Memory.remoteGuardRooms.E9S17.threat, undefined);
    assert.strictEqual(w.g.getSpawnRequest({room: w.home}), undefined);
    const off = world({hostiles: [invader('smallMelee')], memory: {enabled: false}});
    off.g.run();
    assert.strictEqual(off.g.getSpawnRequest({room: off.home}), undefined);
});

// --- role.remoteGuard ----------------------------------------------------------
function guardCreep(remote, s, x = 25, y = 25) {
    const calls = [];
    const body = [].concat(Array(12).fill('move'), Array(18).fill('ranged_attack'), Array(6).fill('heal'))
        .map(type => ({type, hits: 100}));
    const c = makeCreep({id: 'g1', name: 'g1', body, x, y, room: remote.name});
    Object.assign(c, {room: remote, my: true, memory: {role: 'remoteGuard', target: remote.name, home: 'E9S18'}, calls,
        rangedAttack: t => calls.push(['rangedAttack', t.id]), rangedMassAttack: () => calls.push(['mass']),
        heal: t => calls.push(['heal', t.id]), rangedHeal: t => calls.push(['rangedHeal', t.id]),
        move: d => calls.push(['move', d]), moveTo: p => calls.push(['moveTo', p.x, p.y])});
    c.pos.findInRange = (kind, r, opts) => remote.find(kind, opts).filter(o => o.pos && c.pos.getRangeTo(o) <= r);
    c.pos.findClosestByRange = list => list.slice().sort((a, b) => c.pos.getRangeTo(a) - c.pos.getRangeTo(b))[0];
    return c;
}
function roleWorld(hostiles, extra = []) {
    const s = sandbox({PathFinder: {search: () => ({path: [{x: 24, y: 24}]})},
        RoomPosition: function(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }});
    const remote = room('E9S17', hostiles.concat(extra));
    s.Game.rooms.E9S17 = remote;
    return {s, role: s.require('role.remoteGuard'), remote};
}

test('the guard shoots the healer first and heals itself in the same tick', () => {
    const melee = invader('smallRanged', 28, 25), healer = invader('smallHealer', 27, 26);
    const w = roleWorld([melee, healer]);
    const g = guardCreep(w.remote, w.s);
    g.hits = 3000;
    w.role.run(g);
    assert.deepStrictEqual(g.calls.slice(0, 2), [['rangedAttack', healer.id], ['heal', 'g1']]);
});

test('the guard keeps out of melee reach and backs off when badly hurt', () => {
    const w = roleWorld([invader('smallMelee', 26, 25)]);
    const g = guardCreep(w.remote, w.s);
    w.role.run(g);
    assert(g.calls.some(c => c[0] === 'move'), 'flees the adjacent melee invader: ' + JSON.stringify(g.calls));
    const far = roleWorld([invader('smallRanged', 40, 40)]);
    const g2 = guardCreep(far.remote, far.s);
    g2.hits = 1000;
    far.role.run(g2);
    assert.strictEqual(g2.memory.recovering, true);
    assert(g2.calls.some(c => c[0] === 'move'));
});

test('a quiet room means escorting the workers, then going home', () => {
    const worker = makeCreep({id: 'w1', body: [{type: 'work', hits: 100}], x: 40, y: 40, room: 'E9S17'});
    Object.assign(worker, {my: true, memory: {role: 'longDistanceHarvester'}, findKind: 'myCreeps'});
    const w = roleWorld([], [worker]);
    const g = guardCreep(w.remote, w.s);
    w.role.run(g);
    assert.deepStrictEqual(g.calls[g.calls.length - 1], ['moveTo', 40, 40]);
    w.s.Game.time += 400;
    w.role.run(g);
    assert.strictEqual(g.memory.done, true, 'nothing else to guard after the escort time');
});

console.log('PASS: ' + passed + ' remote guard tests');
