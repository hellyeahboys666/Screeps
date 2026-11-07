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
            if (resource == undefined) {
                return Object.values(contents).reduce((sum, amount) => sum + amount, 0);
            }
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

function loadMineralLorry(objects, lorryCalls, reserveStatus) {
    const source = fs.readFileSync(path.join(root, 'role.mineralLorry.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        require(name) {
            if (name == 'role.lorry') {
                return {run() { lorryCalls.push('run'); }};
            }
            if (name == 'energy.reserve') {
                return {
                    getReserveStatus() {
                        return reserveStatus || {target: 0, total: 0, deficit: 0};
                    }
                };
            }
            throw new Error(`unexpected require: ${name}`);
        },
        Game: {
            getObjectById(id) {
                return objects[id];
            }
        },
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
        ERR_INVALID_TARGET: -7,
        ERR_FULL: -8,
        RESOURCE_POWER: 'power',
        RESOURCE_GHODIUM: 'ghodium',
        RESOURCE_ENERGY: 'energy',
        RESOURCE_CATALYZED_LEMERGIUM_ACID: 'XLH2O',
        STRUCTURE_POWER_SPAWN: 'powerSpawn',
        STRUCTURE_NUKER: 'nuker',
        STRUCTURE_LAB: 'lab'
    };
    vm.runInNewContext(source, sandbox, {filename: 'role.mineralLorry.js'});
    return sandbox.module.exports;
}

function makePowerLorry(powerSpawn, terminalPower) {
    const calls = {moves: [], withdraws: [], transfers: []};
    const creep = {
        memory: {
            role: 'mineralLorry',
            empty: true,
            mineralType: 'power',
            specialStructureId: powerSpawn.id,
            specialStructureType: 'powerSpawn'
        },
        room: {
            name: 'E9S19',
            terminal: {
                structureType: 'terminal',
                pos: {roomName: 'E9S19'},
                store: makeStore({power: terminalPower}, {power: 100000})
            },
            storage: undefined
        },
        pos: {
            inRangeTo() {
                return false;
            }
        },
        store: makeStore({}, {power: 100, energy: 100}),
        moveTo(target, options) {
            calls.moves.push({target, options});
            return 0;
        },
        withdraw(source, resource, amount) {
            calls.withdraws.push({source, resource, amount});
            return 0;
        },
        transfer(target, resource, amount) {
            calls.transfers.push({target, resource, amount});
            return 0;
        }
    };
    return {creep, calls};
}

function makePowerSpawn(power, freePower) {
    return {
        id: 'power-spawn-1',
        structureType: 'powerSpawn',
        pos: {roomName: 'E9S19'},
        store: makeStore({power}, {power: freePower})
    };
}

// A full Power Spawn must retain one assigned loader rather than converting it
// to an ordinary lorry. This is the regression that previously created a new
// large lorry after every 1-100 power refill cycle.
{
    const powerSpawn = makePowerSpawn(100, 0);
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls);
    const {creep, calls} = makePowerLorry(powerSpawn, 50);

    role.run(creep);

    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(creep.memory.specialStructureId, powerSpawn.id);
    assert.equal(creep.memory.specialStructureType, 'powerSpawn');
    assert.equal(creep.memory.specialStructureWaiting, true);
    assert.equal(calls.withdraws.length, 0, 'a full Power Spawn must not receive a bounce load');
    assert.equal(lorryCalls.length, 0, 'the assigned loader must not do ordinary lorry work');
    assert.equal(calls.moves.length, 1, 'the loader should park near its Power Spawn');
    assert.equal(calls.moves[0].target, powerSpawn);
    assert.equal(calls.moves[0].options.range, 2);
}

// A dedicated Power Spawn loader should use otherwise idle carry capacity to
// refill the target's energy channel, but only from room energy above reserve.
// Live diagnosis found the loader waiting beside a full-power spawn while that
// spawn had only 9/5000 energy and could not process power.
{
    const powerSpawn = makePowerSpawn(100, 0);
    powerSpawn.store = makeStore({power: 100, energy: 9},
        {power: 0, energy: 4991}, {power: 100, energy: 5000});
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls,
        {target: 300000, total: 300500, deficit: 0});
    const {creep, calls} = makePowerLorry(powerSpawn, 50);
    creep.room.storage = {
        structureType: 'storage',
        pos: {roomName: 'E9S19'},
        store: makeStore({energy: 10000}, {energy: 990000})
    };

    role.run(creep);

    assert.equal(calls.withdraws.length, 1,
        'an idle Power Spawn loader should withdraw reserve-safe energy');
    assert.equal(calls.withdraws[0].source, creep.room.storage);
    assert.equal(calls.withdraws[0].resource, 'energy');
    assert.equal(calls.withdraws[0].amount, 100,
        'energy withdrawal must be bounded by creep capacity and reserve surplus');
    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(creep.memory.specialStructureId, powerSpawn.id);
    assert.equal(lorryCalls.length, 0);
}

// If the Power Spawn also has a power deficit but the room temporarily has no
// loose power, the loader should still service reserve-safe energy instead of
// idling until the next market delivery.
{
    const powerSpawn = makePowerSpawn(99, 1);
    powerSpawn.store = makeStore({power: 99, energy: 9},
        {power: 1, energy: 4991}, {power: 100, energy: 5000});
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls,
        {target: 300000, total: 300500, deficit: 0});
    const {creep, calls} = makePowerLorry(powerSpawn, 0);
    creep.room.storage = {
        structureType: 'storage',
        pos: {roomName: 'E9S19'},
        store: makeStore({energy: 10000}, {energy: 990000})
    };

    role.run(creep);

    assert.equal(calls.withdraws.length, 1);
    assert.equal(calls.withdraws[0].resource, 'energy');
    assert.equal(calls.withdraws[0].amount, 100);
    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(lorryCalls.length, 0);
}

// Energy acquired for the assigned Power Spawn must be delivered directly.
// Delegating this cargo to the generic lorry role can send it back to storage
// because the reserve snapshot drops after withdrawal.
{
    const powerSpawn = makePowerSpawn(100, 0);
    powerSpawn.store = makeStore({power: 100, energy: 9},
        {power: 0, energy: 4991}, {power: 100, energy: 5000});
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls,
        {target: 300000, total: 300000, deficit: 0});
    const {creep, calls} = makePowerLorry(powerSpawn, 50);
    creep.store = makeStore({energy: 100}, {power: 0, energy: 0});
    creep.memory.empty = false;
    creep.memory.specialStructureEnergyLoading = true;

    role.run(creep);

    assert.equal(calls.transfers.length, 1,
        'Power Spawn energy cargo must not fall through to ordinary lorry routing');
    assert.equal(calls.transfers[0].target, powerSpawn);
    assert.equal(calls.transfers[0].resource, 'energy');
    assert.equal(calls.transfers[0].amount, 100);
    assert.equal(lorryCalls.length, 0);
    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(creep.memory.specialStructureId, powerSpawn.id);
}

// When processing consumes power, the same waiting loader must resume loading
// from terminal/storage instead of causing a replacement spawn.
{
    const powerSpawn = makePowerSpawn(99, 1);
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls);
    const {creep, calls} = makePowerLorry(powerSpawn, 50);
    creep.memory.specialStructureWaiting = true;

    role.run(creep);

    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(creep.memory.specialStructureWaiting, undefined);
    assert.equal(calls.withdraws.length, 1);
    assert.equal(calls.withdraws[0].source, creep.room.terminal);
    assert.equal(calls.withdraws[0].resource, 'power');
    assert.equal(calls.withdraws[0].amount, 1);
    assert.equal(lorryCalls.length, 0);
}

// A temporarily empty terminal/storage must leave the Power Spawn loader
// assigned and waiting, not turn it into a normal lorry.
{
    const powerSpawn = makePowerSpawn(99, 1);
    const lorryCalls = [];
    const role = loadMineralLorry({[powerSpawn.id]: powerSpawn}, lorryCalls);
    const {creep, calls} = makePowerLorry(powerSpawn, 0);

    role.run(creep);

    assert.equal(creep.memory.role, 'mineralLorry');
    assert.equal(creep.memory.specialStructureWaiting, true);
    assert.equal(calls.withdraws.length, 0);
    assert.equal(lorryCalls.length, 0);
}

// Assignment loss is the explicit retirement case: a destroyed or mismatched
// target must not leave a permanently idle special loader.
{
    const powerSpawn = makePowerSpawn(99, 1);
    const lorryCalls = [];
    const role = loadMineralLorry({}, lorryCalls);
    const {creep} = makePowerLorry(powerSpawn, 0);
    creep.memory.specialStructureWaiting = true;

    role.run(creep);

    assert.equal(creep.memory.role, 'lorry');
    assert.equal(creep.memory.specialStructureId, undefined);
    assert.equal(creep.memory.specialStructureType, undefined);
    assert.equal(creep.memory.specialStructureWaiting, undefined);
    assert.equal(creep.memory.mineralType, undefined);
}

// The spawn helper must retain the target type in Memory so the assignment is
// inspectable and protected against accidental target-type reuse.
{
    const source = fs.readFileSync(path.join(root, 'prototype.spawn.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        StructureSpawn: function StructureSpawn() {},
        CARRY: 'carry',
        MOVE: 'move',
        ERR_NOT_ENOUGH_ENERGY: -6
    };
    vm.runInNewContext(source, sandbox, {filename: 'prototype.spawn.js'});
    sandbox.module.exports();
    const spawned = [];
    const spawn = {
        room: {name: 'E9S19'},
        spawnCreep(body, name, options) {
            spawned.push({body, name, memory: options.memory});
            return name;
        }
    };
    Object.setPrototypeOf(spawn, sandbox.StructureSpawn.prototype);

    spawn.createMinerallorry(600, 'mineralLorry', 'power', 'powerLorry-1',
        undefined, undefined, 'power-spawn-1', 'powerSpawn');

    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].memory.specialStructureId, 'power-spawn-1');
    assert.equal(spawned[0].memory.specialStructureType, 'powerSpawn');
}

function loadSpecialStructureMarket(memory) {
    const source = fs.readFileSync(path.join(root, 'market.specialStructures.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: {time: 12345},
        Memory: memory || {},
        _: {
            some(collection, predicate) {
                return collection.some(predicate);
            }
        },
        FIND_MY_STRUCTURES: 1,
        STRUCTURE_POWER_SPAWN: 'powerSpawn',
        STRUCTURE_NUKER: 'nuker',
        RESOURCE_POWER: 'power',
        RESOURCE_GHODIUM: 'ghodium'
    };
    vm.runInNewContext(source, sandbox, {filename: 'market.specialStructures.js'});
    return sandbox.module.exports;
}

function makePowerSpawnRequestSpawn(powerSpawn) {
    const memory = {};
    const room = {
        name: 'E9S19',
        memory: {},
        // Deliberately no storage or terminal: assignment must be created as
        // soon as the Power Spawn exists, even before power is available.
        storage: undefined,
        terminal: undefined,
        find(type, options) {
            assert.equal(type, 1);
            return [powerSpawn].filter(options.filter);
        }
    };
    return {memory, room};
}

// A full, unstocked Power Spawn still receives its one dedicated assignment.
// This ensures the loader exists before the first processPower() deficit and
// parks until terminal/storage power later becomes available.
{
    const powerSpawn = {
        id: 'power-spawn-assignment-1',
        structureType: 'powerSpawn',
        store: makeStore({power: 100}, {power: 0}, {power: 100})
    };
    const spawn = makePowerSpawnRequestSpawn(powerSpawn);
    const market = loadSpecialStructureMarket();

    const request = market.getLoadRequest(spawn, []);

    assert.equal(request.structureId, powerSpawn.id);
    assert.equal(request.resource, 'power');
    assert.equal(request.deficit, 0);
    assert.equal(spawn.memory.specialStructureLoadRequest.persistent, true);
    assert.equal(spawn.memory.specialStructureLoadRequest.structureType, 'powerSpawn');

    const assigned = [{memory: {
        role: 'mineralLorry',
        mineralType: 'power',
        specialStructureId: powerSpawn.id
    }}];
    assert.equal(market.getLoadRequest(spawn, assigned), undefined);
    assert.equal(spawn.memory.specialStructureLoadRequest, undefined);
}

const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.match(mainSource,
    /specialStructureLoadRequest\.resource\s*==\s*RESOURCE_POWER[\s\S]{0,250}['"]powerLorry['"][\s\S]{0,700}specialStructureLoadRequest\.structureType/,
    'Power Spawn load requests must create visibly named powerLorry creeps with typed assignments');

console.log('power lorry assignment tests passed');
