const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function makeStore(contents, free, capacity) {
    contents = Object.assign({}, contents || {});
    free = Object.assign({}, free || {});
    capacity = Object.assign({}, capacity || {});
    return {
        getUsedCapacity(resource) {
            return contents[resource] || 0;
        },
        getFreeCapacity(resource) {
            return free[resource] || 0;
        },
        getCapacity(resource) {
            return capacity[resource];
        }
    };
}

function makeStructure(id, structureType) {
    const resource = structureType == 'powerSpawn' ? 'power' : 'ghodium';
    const resourceCapacity = structureType == 'powerSpawn' ? 100 : 5000;
    const structure = {
        id,
        structureType,
        store: makeStore(
            {[resource]: 1, energy: 50},
            {[resource]: resourceCapacity - 1, energy: 4950},
            {[resource]: resourceCapacity, energy: 5000})
    };
    if (structureType == 'powerSpawn') {
        structure.processPower = function processPower() {
            structure.processCalls = (structure.processCalls || 0) + 1;
            return 0;
        };
    }
    return structure;
}

function loadSpecialStructureMarket(game, memory) {
    const source = fs.readFileSync(path.join(root, 'market.specialStructures.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: game,
        Memory: memory,
        _: {some(collection, predicate) { return collection.some(predicate); }},
        FIND_MY_STRUCTURES: 1,
        STRUCTURE_POWER_SPAWN: 'powerSpawn',
        STRUCTURE_NUKER: 'nuker',
        RESOURCE_POWER: 'power',
        RESOURCE_GHODIUM: 'ghodium',
        RESOURCE_ENERGY: 'energy'
    };
    vm.runInNewContext(source, sandbox, {filename: 'market.specialStructures.js'});
    return sandbox.module.exports;
}

function loadPowerSpawnManager(game, memory, specialStructureMarket) {
    const source = fs.readFileSync(path.join(root, 'power.spawn.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: game,
        Memory: memory,
        require(name) {
            if (name == 'energy.reserve') {
                return {
                    getReserveStatus() { return {target: 0, total: 1000, deficit: 0}; },
                    needsRoomEnergyReserve() { return false; }
                };
            }
            if (name == 'market.specialStructures') {
                return specialStructureMarket;
            }
            throw new Error(`unexpected require: ${name}`);
        },
        POWER_SPAWN_ENERGY_RATIO: 50,
        FIND_MY_STRUCTURES: 1,
        STRUCTURE_POWER_SPAWN: 'powerSpawn',
        RESOURCE_POWER: 'power',
        RESOURCE_ENERGY: 'energy'
    };
    vm.runInNewContext(source, sandbox, {filename: 'power.spawn.js'});
    return sandbox.module.exports;
}

function makeRoom(name, structures) {
    return {
        name,
        memory: {},
        structures,
        findCalls: 0,
        find(type, options) {
            assert.equal(type, 1);
            this.findCalls += 1;
            const current = this.structures.slice();
            return options && options.filter ? current.filter(options.filter) : current;
        }
    };
}

const game = {time: 500};
const memory = {};
const market = loadSpecialStructureMarket(game, memory);
const powerManager = loadPowerSpawnManager(game, memory, market);
const powerSpawn = makeStructure('power-1', 'powerSpawn');
const nuker = makeStructure('nuker-1', 'nuker');
const room = makeRoom('E9S19', [powerSpawn, nuker]);
powerSpawn.room = room;
nuker.room = room;
const spawn = {memory: {}, room};

// Resource needs, lorry sink selection, and Power Spawn processing all discover
// the same owned special structures. They should share one room scan per tick.
assert.equal(market.getResourceNeeds(room).length, 2);
assert.equal(market.getEnergySink(room, true, true), powerSpawn);
powerManager.run(spawn);
assert.equal(room.findCalls, 1,
    'special-structure consumers must share one owned-structure scan per room/tick');
assert.equal(powerSpawn.processCalls, 1, 'Power Spawn processing behavior must be unchanged');

// The next tick must refresh structure references so construction/destruction is
// visible without a persistent topology cache.
game.time += 1;
room.structures = [nuker];
const refreshedNeeds = market.getResourceNeeds(room);
assert.equal(room.findCalls, 2, 'the special-structure cache must refresh next tick');
assert.deepEqual(Array.from(refreshedNeeds, need => need.structureId), [nuker.id]);

// A different room in the same tick needs its own cache entry.
const otherPowerSpawn = makeStructure('power-2', 'powerSpawn');
const otherRoom = makeRoom('E8S19', [otherPowerSpawn]);
otherPowerSpawn.room = otherRoom;
assert.equal(market.getResourceNeeds(otherRoom).length, 1);
assert.equal(otherRoom.findCalls, 1);
assert.equal(room.findCalls, 2);

console.log('special structure discovery cache tests passed');
