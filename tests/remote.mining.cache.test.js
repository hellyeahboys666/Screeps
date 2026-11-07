const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'manager.remoteMining.js'), 'utf8');

let creepScans = 0;
const creepData = {};
const creeps = new Proxy(creepData, {
    ownKeys(target) {
        creepScans += 1;
        return Reflect.ownKeys(target);
    }
});

const lodash = {
    some(collection, predicate) {
        for (const key in collection) {
            if (predicate(collection[key])) {
                return true;
            }
        }
        return false;
    },
    sum(collection, predicate) {
        let total = 0;
        for (const key in collection) {
            if (predicate(collection[key])) {
                total += 1;
            }
        }
        return total;
    }
};

const room = {
    name: 'E9S18',
    energyCapacityAvailable: 1300
};
const spawn = {
    name: 'Spawn1',
    owner: {username: 'Leo'},
    memory: {
        defaultRemoteOwner: true,
        minLDH_E11S23Source0: 1,
        reserveRooms: ['E9S17']
    },
    room
};
const remoteRoom = {
    name: 'E9S17',
    controller: {
        reservation: {username: 'Leo', ticksToEnd: 1000}
    }
};

function makeCreep(name, role, extra) {
    return {
        name,
        owner: {username: 'Leo'},
        memory: Object.assign({role, home: 'E9S18', target: 'E9S17'}, extra || {}),
        spawning: false,
        ticksToLive: 1000,
        getActiveBodyparts(part) {
            if (part == 'work') {
                return this.memory.workParts || 0;
            }
            if (part == 'move') {
                return this.memory.moveParts || 0;
            }
            return 0;
        }
    };
}

creepData['ldh-good'] = makeCreep('ldh-good', 'longDistanceHarvester', {
    sourceId: 0,
    reserved: true,
    workParts: 6,
    moveParts: 3
});
creepData['ldh-old'] = makeCreep('ldh-old', 'longDistanceHarvester', {
    sourceId: 0,
    reserved: false,
    workParts: 3,
    moveParts: 1
});
creepData['remote-lorry'] = makeCreep('remote-lorry', 'remoteLorry', {sourceId: 0});
creepData['reserver'] = makeCreep('reserver', 'reserver');
creepData['unrelated'] = makeCreep('unrelated', 'builder', {target: undefined});

const game = {
    time: 100,
    creeps,
    rooms: {E9S17: remoteRoom},
    spawns: {Spawn1: spawn}
};
const sandbox = {
    module: {exports: {}},
    exports: {},
    Game: game,
    global: {},
    _: lodash,
    WORK: 'work',
    MOVE: 'move'
};
vm.runInNewContext(source, sandbox, {filename: 'manager.remoteMining.js'});
const remoteMining = sandbox.module.exports;

// Spawn planning needs total/qualified harvesters, lorries, and reserver state.
// All of those views should come from one Game.creeps index build per tick.
const firstPlan = remoteMining.getSpawnPlan(spawn);
assert.equal(firstPlan.defaultRemote.harvesterTotalCount, 2);
assert.equal(firstPlan.defaultRemote.harvesterCount, 1);
assert.equal(firstPlan.defaultRemote.undersizedHarvesterCount, 1);
assert.equal(firstPlan.defaultRemote.remoteLorryCount, 1);
assert.equal(firstPlan.defaultRemote.reserverCount, 1);
assert.equal(firstPlan.manualReservePlan.reserversByRoom.E9S17, 1);
assert.equal(firstPlan.manualReservePlan.needsByRoom.E9S17, false);
assert.equal(creepScans, 1,
    'remote-mining planning must build one shared creep index per tick');

// A second same-tick spawn-plan request must reuse the same index.
const secondPlan = remoteMining.getSpawnPlan(spawn);
assert.equal(secondPlan.defaultRemote.harvesterTotalCount, 2);
assert.equal(secondPlan.defaultRemote.remoteLorryCount, 1);
assert.equal(creepScans, 1,
    'same-tick planning must not rescan Game.creeps');

// Retirement checks run from each remote harvester role and should reuse the
// same index rather than launching another Game-wide search per creep.
assert.equal(remoteMining.shouldRetireObsoleteDefaultRemoteHarvester(creepData['ldh-old']), true);
assert.equal(remoteMining.shouldRetireObsoleteDefaultRemoteHarvester(creepData['ldh-good']), false);
assert.equal(creepScans, 1,
    'remote-harvester retirement checks must reuse the tick index');

// The next tick must rebuild from current live creeps. Owner migration via the
// active creep home must still work when no explicit owner is configured.
game.time += 1;
delete spawn.memory.defaultRemoteOwner;
creepData['remote-lorry-2'] = makeCreep('remote-lorry-2', 'remoteLorry', {sourceId: 0});
const refreshedPlan = remoteMining.getSpawnPlan(spawn);
assert.equal(refreshedPlan.defaultRemote.ownerName, spawn.name);
assert.equal(refreshedPlan.defaultRemote.ownerReason, 'activeCreepHome');
assert.equal(refreshedPlan.defaultRemote.remoteLorryCount, 2);
assert.equal(creepScans, 2,
    'remote-mining creep index must refresh exactly once on the next tick');

// A spawn with no remote ownership or manual reserve rooms should not build the
// index merely to produce an empty plan.
const idleSpawn = {
    name: 'Spawn2',
    owner: {username: 'Leo'},
    memory: {},
    room: {name: 'E8S18', energyCapacityAvailable: 800}
};
spawn.memory.defaultRemoteOwner = true;
game.spawns.Spawn2 = idleSpawn;
game.time += 1;
const scansBeforeIdlePlan = creepScans;
const idlePlan = remoteMining.getSpawnPlan(idleSpawn);
assert.equal(idlePlan.defaultRemote.isOwner, false);
assert.deepEqual(Array.from(idlePlan.manualReserveRooms), []);
assert.equal(creepScans, scansBeforeIdlePlan,
    'idle non-owner spawn planning must not scan Game.creeps');

console.log('remote mining creep index tests passed');
