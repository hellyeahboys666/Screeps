const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function makeStore(contents, capacity) {
    contents = Object.assign({}, contents || {});
    capacity = capacity == undefined ? 100 : capacity;
    return {
        getUsedCapacity(resource) {
            if (resource == undefined) {
                return Object.values(contents).reduce((sum, amount) => sum + amount, 0);
            }
            return contents[resource] || 0;
        },
        getFreeCapacity(resource) {
            if (resource != undefined) {
                return Math.max(0, capacity - (contents[resource] || 0));
            }
            return Math.max(0, capacity - Object.values(contents).reduce((sum, amount) => sum + amount, 0));
        }
    };
}

function makeRoom(powerSpawn, powerEnabled) {
    const room = {
        name: 'E9S19',
        controller: {
            my: true,
            level: 8,
            isPowerEnabled: powerEnabled,
            pos: {x: 20, y: 20, roomName: 'E9S19'}
        },
        storage: {
            id: 'storage-1',
            pos: {x: 25, y: 25, roomName: 'E9S19'},
            store: makeStore({}, 1000000)
        },
        terminal: undefined
    };
    powerSpawn.room = room;
    return room;
}

function makePowerCreep(options) {
    options = options || {};
    const calls = {spawn: [], moveTo: [], renew: [], enableRoom: [], usePower: [], transfer: []};
    const powerCreep = {
        name: 'Operator1',
        className: 'operator',
        level: 1,
        memory: Object.assign({}, options.memory || {}),
        ticksToLive: options.spawned === false ? undefined : (options.ticksToLive == undefined ? 5000 : options.ticksToLive),
        spawnCooldownTime: options.spawnCooldownTime || 0,
        room: options.room,
        powers: {'1': {level: 1, cooldown: options.generateCooldown || 0}},
        store: makeStore({ops: options.ops || 0}, 100),
        pos: {
            isNearTo(target) {
                return options.nearTarget === target;
            }
        },
        spawn(target) { calls.spawn.push(target); return 0; },
        moveTo(target, moveOptions) { calls.moveTo.push({target, options: moveOptions}); return 0; },
        renew(target) { calls.renew.push(target); return 0; },
        enableRoom(target) { calls.enableRoom.push(target); return 0; },
        usePower(power, target) { calls.usePower.push({power, target}); return 0; },
        transfer(target, resource) { calls.transfer.push({target, resource}); return 0; }
    };
    return {powerCreep, calls};
}

function loadManager(game, memory, powerSpawns) {
    const source = fs.readFileSync(path.join(root, 'manager.powerCreeps.js'), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: game,
        Memory: memory,
        Date,
        require(name) {
            if (name == 'market.specialStructures') {
                return {
                    getOwnedStructures(room, structureType) {
                        assert.equal(structureType, 'powerSpawn');
                        return powerSpawns.filter(structure => structure.room === room);
                    }
                };
            }
            throw new Error(`unexpected require: ${name}`);
        },
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
        FIND_MY_STRUCTURES: 1,
        STRUCTURE_POWER_SPAWN: 'powerSpawn',
        RESOURCE_OPS: 'ops',
        PWR_GENERATE_OPS: 1,
        POWER_INFO: {1: {effect: [1]}}
    };
    vm.runInNewContext(source, sandbox, {filename: 'manager.powerCreeps.js'});
    return sandbox.module.exports;
}

(function testManagerIsOptIn() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, false);
    const {powerCreep, calls} = makePowerCreep({spawned: false});
    const game = {time: 100, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {};
    const manager = loadManager(game, memory, [powerSpawn]);

    const status = manager.run();

    assert.equal(status.enabled, false);
    assert.equal(calls.spawn.length, 0, 'disabled-by-default manager must not spawn a Power Creep');
    assert.equal(calls.moveTo.length, 0, 'disabled-by-default manager must not move a Power Creep');
    assert.equal(calls.renew.length, 0, 'disabled-by-default manager must not renew a Power Creep');
    assert.equal(calls.enableRoom.length, 0, 'disabled-by-default manager must not enable a room');
    assert.equal(calls.usePower.length, 0, 'disabled-by-default manager must not use powers');
    assert.equal(calls.transfer.length, 0, 'disabled-by-default manager must not transfer resources');
})();

(function testEnabledManagerSpawnsAtAssignedPowerSpawn() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, false);
    const {powerCreep, calls} = makePowerCreep({spawned: false, memory: {homeRoom: 'E9S19'}});
    const game = {time: 101, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {powerCreepManagerEnabled: true};
    const manager = loadManager(game, memory, [powerSpawn]);

    const status = manager.run();

    assert.equal(calls.spawn.length, 1);
    assert.equal(calls.spawn[0], powerSpawn);
    assert.equal(status.creeps.Operator1.action, 'spawn');
    assert.equal(status.creeps.Operator1.result, 0);
})();

(function testFreshPowerCreepEnablesHomeRoomBeforeUsingPower() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, false);
    const {powerCreep, calls} = makePowerCreep({room, memory: {homeRoom: 'E9S19'}});
    const game = {time: 102, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {powerCreepManagerEnabled: true};
    const manager = loadManager(game, memory, [powerSpawn]);

    let status = manager.run();
    assert.equal(calls.moveTo.length, 1);
    assert.equal(calls.moveTo[0].target, room.controller);
    assert.equal(calls.enableRoom.length, 0);
    assert.equal(calls.usePower.length, 0);
    assert.equal(status.creeps.Operator1.action, 'moveToEnableRoom');

    powerCreep.pos.isNearTo = target => target === room.controller;
    game.time++;
    status = manager.run();
    assert.equal(calls.enableRoom.length, 1);
    assert.equal(calls.enableRoom[0], room.controller);
    assert.equal(calls.usePower.length, 0, 'enabling and power use should not compete in one tick');
    assert.equal(status.creeps.Operator1.action, 'enableRoom');
})();

(function testPowerEnabledOperatorGeneratesOps() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, true);
    const {powerCreep, calls} = makePowerCreep({room, memory: {homeRoom: 'E9S19'}, ops: 10});
    const game = {time: 103, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {powerCreepManagerEnabled: true};
    const manager = loadManager(game, memory, [powerSpawn]);

    const status = manager.run();

    assert.equal(calls.usePower.length, 1);
    assert.equal(calls.usePower[0].power, 1);
    assert.equal(status.creeps.Operator1.action, 'generateOps');
})();

(function testLowLifeOperatorRenewsBeforeRoutineWork() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, true);
    const {powerCreep, calls} = makePowerCreep({
        room,
        memory: {homeRoom: 'E9S19'},
        ticksToLive: 900,
        nearTarget: powerSpawn
    });
    const game = {time: 104, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {powerCreepManagerEnabled: true};
    const manager = loadManager(game, memory, [powerSpawn]);

    const status = manager.run();

    assert.equal(calls.renew.length, 1);
    assert.equal(calls.renew[0], powerSpawn);
    assert.equal(calls.usePower.length, 0);
    assert.equal(status.creeps.Operator1.action, 'renew');
})();

(function testOperatorUnloadsOpsBeforeItsStoreFills() {
    const powerSpawn = {id: 'ps-1', structureType: 'powerSpawn'};
    const room = makeRoom(powerSpawn, true);
    const {powerCreep, calls} = makePowerCreep({
        room,
        memory: {homeRoom: 'E9S19'},
        ops: 80,
        nearTarget: room.storage
    });
    const game = {time: 105, rooms: {E9S19: room}, powerCreeps: {Operator1: powerCreep}};
    const memory = {powerCreepManagerEnabled: true};
    const manager = loadManager(game, memory, [powerSpawn]);

    const status = manager.run();

    assert.equal(calls.transfer.length, 1);
    assert.equal(calls.transfer[0].target, room.storage);
    assert.equal(calls.transfer[0].resource, 'ops');
    assert.equal(calls.usePower.length, 0);
    assert.equal(status.creeps.Operator1.action, 'unloadOps');
})();

const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.match(mainSource, /require\(['"]manager\.powerCreeps['"]\)/,
    'main loop should load the Power Creep manager');
assert.match(mainSource, /powerCreepManager\.run\(\)/,
    'main loop should run the Power Creep manager once per tick');

console.log('power creep manager tests passed');
