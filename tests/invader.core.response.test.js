const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const constants = {
    FIND_HOSTILE_STRUCTURES: 109,
    FIND_MY_SPAWNS: 112,
    STRUCTURE_INVADER_CORE: 'invaderCore',
    ERR_NOT_ENOUGH_ENERGY: -6,
    ERR_NOT_IN_RANGE: -9,
    OK: 0,
    MOVE: 'move',
    ATTACK: 'attack',
    WORK: 'work',
    ATTACK_POWER: 30
};

// --- manager.remoteMining.js: detection, gating, strongholds -----------------

let finds = 0;
let cores = [];
const remoteRoom = {
    name: 'E9S17',
    controller: {reservation: {username: 'Invader', ticksToEnd: 300}},
    find(type, opts) {
        finds += 1;
        assert.equal(type, constants.FIND_HOSTILE_STRUCTURES);
        return opts && opts.filter ? cores.filter(opts.filter) : cores.slice();
    }
};
const spawn = {
    name: 'Spawn1',
    owner: {username: 'Leo'},
    spawning: null,
    memory: {defaultRemoteOwner: true, minLDH_E11S23Source0: 1},
    room: {name: 'E9S18', energyCapacityAvailable: 1300}
};
const otherSpawn = {
    name: 'Spawn2',
    owner: {username: 'Leo'},
    spawning: null,
    memory: {reserveRooms: ['E9S17']},
    room: {name: 'E8S18', energyCapacityAvailable: 1300}
};
const creeps = {};
const game = {time: 1000, creeps, rooms: {E9S17: remoteRoom}, spawns: {Spawn1: spawn, Spawn2: otherSpawn}};
const memory = {};
const sandbox = Object.assign({
    module: {exports: {}},
    exports: {},
    Game: game,
    Memory: memory,
    global: {},
    _: {
        some(collection, predicate) { for (const key in collection) { if (predicate(collection[key])) return true; } return false; },
        sum(collection, predicate) { let n = 0; for (const key in collection) { if (predicate(collection[key])) n += 1; } return n; }
    }
}, constants);
vm.runInNewContext(fs.readFileSync(path.join(root, 'manager.remoteMining.js'), 'utf8'), sandbox, {filename: 'manager.remoteMining.js'});
const remoteMining = sandbox.module.exports;

function plan(s) {
    return remoteMining.getSpawnPlan(s);
}

// A remote reserved by us never triggers a structure search.
remoteRoom.controller.reservation = {username: 'Leo', ticksToEnd: 4000};
plan(spawn);
assert.equal(finds, 0, 'normal planning must stay a reservation check');

// A level-0 core reserving the default remote asks the home spawn for a breaker.
remoteRoom.controller.reservation = {username: 'Invader', ticksToEnd: 300};
cores = [{id: 'core1', structureType: 'invaderCore', level: 0, hits: 100000}];
let request = plan(spawn).invaderCoreRequest;
assert.deepEqual(JSON.parse(JSON.stringify(request)), {roomName: 'E9S17', targetId: 'core1', hits: 100000});
assert.equal(spawn.memory.remoteInvaderCores.E9S17.level, 0);
assert.equal(plan(spawn).defaultRemote.active, false, 'mining stays backed off while Invader holds the reservation');

// A second spawn planning the same remote in the same tick must not double-spawn.
assert.equal(plan(otherSpawn).invaderCoreRequest, undefined, 'same-tick claim stops a second spawn');

// No new breaker while one is alive or still spawning.
game.time += 1;
creeps.breaker = {name: 'breaker', spawning: true, memory: {role: 'attacker', invaderCoreRoom: 'E9S17', home: 'E9S18'}};
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'one breaker at a time');
delete creeps.breaker;

// Off switches.
game.time += 1;
memory.autoInvaderCoreResponse = false;
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'global off switch');
delete memory.autoInvaderCoreResponse;
game.time += 1;
spawn.memory.autoInvaderCoreResponse = false;
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'per-spawn off switch');
delete spawn.memory.autoInvaderCoreResponse;

// A busy spawn does not take the request.
game.time += 1;
spawn.spawning = {name: 'x'};
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'spawning spawn skips');
spawn.spawning = null;

// Vision lost: the remembered core still gets a breaker, until the record ages out.
game.time += 1;
delete game.rooms.E9S17;
request = plan(spawn).invaderCoreRequest;
assert.equal(request && request.targetId, 'core1', 'remembered core is still answered without vision');
game.time += 5001;
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'stale sighting expires');
assert.equal(spawn.memory.remoteInvaderCores.E9S17, undefined);
game.rooms.E9S17 = remoteRoom;

// Core destroyed: record cleared, no request; the leftover Invader reservation
// still blocks mining until it expires.
game.time += 1;
plan(spawn);
cores = [];
game.time += 1;
assert.equal(plan(spawn).invaderCoreRequest, undefined);
assert.equal(spawn.memory.remoteInvaderCores.E9S17, undefined);
assert.equal(plan(spawn).defaultRemote.active, false);
remoteRoom.controller.reservation = undefined;
game.time += 1;
assert.equal(plan(spawn).defaultRemote.active, true, 'mining resumes once the reservation is gone');

// Level 1+ strongholds: no breaker, and mining stays backed off even if the
// controller shows no reservation.
game.time += 1;
remoteRoom.controller.reservation = {username: 'Invader', ticksToEnd: 300};
cores = [{id: 'core2', structureType: 'invaderCore', level: 2, hits: 100000}];
assert.equal(plan(spawn).invaderCoreRequest, undefined, 'strongholds are left alone');
remoteRoom.controller.reservation = undefined;
game.time += 1;
assert.equal(plan(spawn).defaultRemote.active, false, 'stronghold keeps mining backed off');

// --- prototype.spawn.js: breaker sizing ---------------------------------------

function StructureSpawn() {}
const spawnSandbox = Object.assign({module: {exports: {}}, exports: {}, StructureSpawn}, constants);
vm.runInNewContext(fs.readFileSync(path.join(root, 'prototype.spawn.js'), 'utf8'), spawnSandbox, {filename: 'prototype.spawn.js'});
spawnSandbox.module.exports();
function breakerSpawn(capacity) {
    const s = new StructureSpawn();
    s.room = {name: 'E9S18', energyCapacityAvailable: capacity};
    s.spawnCreep = function(body, name, opts) { this.last = {body, name, memory: opts.memory}; return constants.OK; };
    return s;
}
let s = breakerSpawn(1300);
assert.equal(s.createCoreBreaker(1300, 'E9S17', 'core1', 100000, 'cb'), constants.OK);
assert.equal(s.last.body.filter(p => p == 'attack').length, 10, 'capped by energy capacity (130 per pair)');
assert.equal(s.last.body.length, 20);
assert.equal(s.last.memory.role, 'attacker');
assert.equal(s.last.memory.targetId, 'core1');
assert.equal(s.last.memory.invaderCoreRoom, 'E9S17');
s = breakerSpawn(5600);
s.createCoreBreaker(5600, 'E9S17', 'core1', 100000, 'cb');
assert.equal(s.last.body.filter(p => p == 'attack').length, 12, '~300 ticks of attacking for a full core');
s = breakerSpawn(5600);
s.createCoreBreaker(5600, 'E9S17', 'core1', 20000, 'cb');
assert.equal(s.last.body.filter(p => p == 'attack').length, 3, 'damaged core needs a smaller breaker');
s = breakerSpawn(1300);
assert.equal(s.createCoreBreaker(800, 'E9S17', 'core1', 100000, 'cb'), constants.ERR_NOT_ENOUGH_ENERGY,
    'waits for the full affordable body instead of sending a half-size one');
s = breakerSpawn(400);
assert.equal(s.createCoreBreaker(400, 'E9S17', 'core1', 100000, 'cb'), constants.ERR_NOT_ENOUGH_ENERGY,
    'refuses a body that could not finish within its lifetime');

// --- role.attacker.js: finish the job, then recycle ---------------------------

const roomObjects = {};
let recycled = 0;
let movedTo;
const homeSpawn = {
    pos: {x: 10, y: 10, roomName: 'E9S18'},
    recycleCreep(creep) { if (creep.pos.roomName != 'E9S18') return constants.ERR_NOT_IN_RANGE; recycled += 1; return constants.OK; }
};
const attackerGame = {
    time: 1,
    creeps: {},
    rooms: {},
    flags: {},
    map: {findRoute() { return -2; }},
    getObjectById(id) { return roomObjects[id] || null; }
};
const attackerSandbox = Object.assign({
    module: {exports: {}},
    exports: {},
    Game: attackerGame,
    RoomPosition: function(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
    require(name) { if (name == 'combat.math') return {}; throw new Error('unexpected require ' + name); }
}, constants);
vm.runInNewContext(fs.readFileSync(path.join(root, 'role.attacker.js'), 'utf8'), attackerSandbox, {filename: 'role.attacker.js'});
const roleAttacker = attackerSandbox.module.exports;
const breaker = {
    name: 'cb',
    hits: 2000,
    hitsMax: 2000,
    memory: {role: 'attacker', style: 'coreBreaker', invaderCoreRoom: 'E9S17', targetId: 'core1', targetRoom: 'E9S17', home: 'E9S18'},
    pos: {x: 25, y: 25, roomName: 'E9S17', findClosestByRange() { return this.roomName == 'E9S18' ? homeSpawn : null; }},
    room: {name: 'E9S17', find() { return []; }},
    getActiveBodyparts() { return 0; },
    moveTo(target) { movedTo = target; return constants.OK; }
};
// Core is dead and no other level-0 core is in the room: mark done, stop
// counting as this remote's breaker, and head home.
roleAttacker.run(breaker);
assert.equal(breaker.memory.coreDone, true);
assert.equal(breaker.memory.invaderCoreRoom, undefined);
assert.equal(movedTo && movedTo.roomName, 'E9S18', 'finished breaker heads home');
// At home it recycles at the nearest spawn.
breaker.pos.roomName = 'E9S18';
breaker.room = {name: 'E9S18', find() { return []; }};
roleAttacker.run(breaker);
assert.equal(recycled, 1, 'finished breaker recycles at home');

console.log('invader core response tests passed');
