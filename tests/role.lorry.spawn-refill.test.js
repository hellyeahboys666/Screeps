'use strict';
// A collecting lorry must refill a drained spawn/extension pool from storage instead
// of walking to small source-side piles until it is 75% full (seen live in E7S18).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'role.lorry.js'), 'utf8');

function loadLorry() {
    const sandbox = {
        module: {exports: {}},
        exports: {},
        global: {},
        Game: {time: 100, creeps: {}, spawns: {}, getObjectById() { return null; }},
        Memory: {},
        require(name) {
            if (name == 'energy.fallback') return {dropAtSpawnPile() {}, isSpawnDropPile() { return false; }};
            if (name == 'energy.reserve') {
                return {needsRoomEnergyReserve() { return true; }, getTerminalRebalanceReserve() { return 10000; }};
            }
            if (name == 'source.link') {
                return {findUsableControllerLinks() { return []; }, isUsableControllerLink() { return false; }};
            }
            if (name == 'remote.build.depot') {
                return {isRemoteBuildDepotEnergyStructure() { return false; }, isRemoteBuildDepotDroppedEnergy() { return false; }};
            }
            if (name == 'market.specialStructures') return {getEnergySink() { return undefined; }};
            throw new Error(`unexpected require: ${name}`);
        },
        RESOURCE_ENERGY: 'energy',
        FIND_MY_STRUCTURES: 'myStructures',
        FIND_STRUCTURES: 'structures',
        FIND_DROPPED_RESOURCES: 'dropped',
        FIND_MY_CREEPS: 'myCreeps',
        STRUCTURE_TOWER: 'tower',
        STRUCTURE_STORAGE: 'storage',
        STRUCTURE_CONTAINER: 'container',
        STRUCTURE_LINK: 'link',
        STRUCTURE_SPAWN: 'spawn',
        STRUCTURE_EXTENSION: 'extension',
        OK: 0,
        ERR_NOT_IN_RANGE: -9
    };
    vm.runInNewContext(source, sandbox, {filename: 'role.lorry.js'});
    return sandbox.module.exports;
}

function store(energy, capacity) {
    return {
        energy,
        getUsedCapacity(r) { return r === undefined || r == 'energy' ? energy : 0; },
        getFreeCapacity(r) { return r === undefined || r == 'energy' ? capacity - energy : 0; },
        getCapacity() { return capacity; }
    };
}

function makeRoom({available, capacity, storageEnergy, hostiles}) {
    const storage = storageEnergy === undefined ? undefined
        : {id: 'storage', structureType: 'storage', store: store(storageEnergy, 1000000), pos: {roomName: 'E7S18', findInRange() { return []; }}};
    return {
        name: 'E7S18',
        energyAvailable: available,
        energyCapacityAvailable: capacity,
        storage,
        memory: hostiles ? {hostileCount: 1, hostileLastSeen: 100} : {},
        find() { return []; }
    };
}

(function testDrainedSpawnPoolGivesStorageFirst() {
    const lorry = loadLorry();
    const reason = lorry._test.getStoragePickupPriorityReason;
    assert.strictEqual(reason(makeRoom({available: 1454, capacity: 5600, storageEnergy: 940000}), false), 'spawnRefill');
    assert.strictEqual(reason(makeRoom({available: 2800, capacity: 5600, storageEnergy: 940000}), false), undefined,
        'half full is not drained');
    assert.strictEqual(reason(makeRoom({available: 1000, capacity: 5600, storageEnergy: 19999}), false), undefined,
        'a near-empty storage is not drawn down for this');
    assert.strictEqual(reason(makeRoom({available: 1000, capacity: 5600}), false), undefined, 'no storage');
    assert.strictEqual(reason(makeRoom({available: 1000, capacity: 5600, storageEnergy: 940000}), true), 'combat',
        'combat keeps its own reason');
})();

(function testPartLoadedLorryTopsUpFromStorageInsteadOfSmallContainer() {
    const lorry = loadLorry();
    const room = makeRoom({available: 1454, capacity: 5600, storageEnergy: 940000});
    const smallContainer = {id: 'c1', structureType: 'container', store: store(30, 2000), pos: {roomName: 'E7S18'}};
    room.find = (type) => type == 'structures' ? [smallContainer] : [];
    const calls = [];
    const creep = {
        name: 'lorry-1',
        room,
        memory: {role: 'lorry', empty: true},
        carry: {energy: 600},
        carryCapacity: 1600,
        store: store(600, 1600),
        pos: {
            roomName: 'E7S18',
            findClosestByRange() { return undefined; },
            findClosestByPath(type, opts) { return [smallContainer].filter(opts.filter)[0]; },
            findInRange() { return []; },
            getRangeTo() { return 5; }
        },
        withdraw(target) { calls.push(['withdraw', target.id]); return 0; },
        pickup(target) { calls.push(['pickup', target.id]); return 0; },
        transfer(target) { calls.push(['transfer', target.id]); return 0; },
        moveTo(target) { calls.push(['moveTo', target.id]); return 0; }
    };
    lorry.run(creep);
    assert.deepStrictEqual(calls[0], ['withdraw', 'storage'], JSON.stringify(calls));
    assert.strictEqual(creep.memory.storagePickupPriority, 'spawnRefill');
    assert.strictEqual(creep.memory.lorryPickupId, undefined, 'no sticky container pickup');
})();

console.log('lorry spawn-refill tests passed');
