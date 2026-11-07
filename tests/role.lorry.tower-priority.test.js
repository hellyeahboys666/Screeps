'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'role.lorry.js'), 'utf8');

function loadLorryHarness() {
    const sandbox = {
        module: {exports: {}},
        exports: {},
        global: {},
        Game: {time: 100, creeps: {}, spawns: {}},
        Memory: {},
        require(name) {
            if (name == 'energy.fallback') {
                return {dropAtSpawnPile() {}};
            }
            if (name == 'energy.reserve') {
                return {
                    needsRoomEnergyReserve() { return true; },
                    getTerminalRebalanceReserve() { return 10000; }
                };
            }
            if (name == 'source.link') {
                return {
                    findUsableControllerLinks() { return []; },
                    isUsableControllerLink() { return false; }
                };
            }
            if (name == 'remote.build.depot') {
                return {
                    isRemoteBuildDepotEnergyStructure() { return false; },
                    isRemoteBuildDepotDroppedEnergy() { return false; }
                };
            }
            if (name == 'market.specialStructures') {
                return {getEnergySink() { return undefined; }};
            }
            throw new Error(`unexpected require: ${name}`);
        },
        RESOURCE_ENERGY: 'energy',
        FIND_MY_STRUCTURES: 'myStructures',
        STRUCTURE_TOWER: 'tower',
        STRUCTURE_STORAGE: 'storage',
        OK: 0,
        ERR_NOT_IN_RANGE: -9
    };
    vm.runInNewContext(source, sandbox, {filename: 'role.lorry.js'});
    return {role: sandbox.module.exports, sandbox};
}

function makeTower(id, energy, range) {
    return {
        id,
        structureType: 'tower',
        range,
        store: {
            getUsedCapacity(resource) {
                assert.strictEqual(resource, 'energy');
                return energy;
            },
            getFreeCapacity(resource) {
                assert.strictEqual(resource, 'energy');
                return 1000 - energy;
            }
        }
    };
}

function makeCreep(structures, storage) {
    const room = {
        name: 'E9S18',
        memory: {},
        storage,
        find(type, options) {
            assert.strictEqual(type, 'myStructures');
            return structures.filter(options.filter);
        }
    };
    return {
        carry: {energy: 100},
        carryCapacity: 100,
        memory: {empty: false, storageRebalance: true},
        room,
        pos: {
            getRangeTo(target) { return target.range; },
            findClosestByPath() { return undefined; },
            findClosestByRange() { return undefined; }
        },
        store: {
            getUsedCapacity(resource) { return resource == 'energy' ? 100 : 0; }
        },
        transfer(target, resource) {
            assert.strictEqual(resource, 'energy');
            this.transferredTo = target;
            return 0;
        },
        moveTo() {
            throw new Error('selected delivery target should already be in range in this harness');
        }
    };
}

(function testMostDepletedTowerWinsBeforeRange() {
    const harness = loadLorryHarness();
    const fartherWeakest = makeTower('tower-a', 100, 9);
    const nearer = makeTower('tower-b', 300, 1);
    const creep = makeCreep([nearer, fartherWeakest]);

    assert.strictEqual(
        harness.role._test.findMostDepletedTowerBelowMaintenanceReserve(creep),
        fartherWeakest,
        'tower energy deficit must take priority over travel range'
    );
})();

(function testRangeAndIdBreakEqualEnergyTiesDeterministically() {
    const harness = loadLorryHarness();
    const far = makeTower('tower-c', 100, 5);
    const nearB = makeTower('tower-b', 100, 2);
    const nearA = makeTower('tower-a', 100, 2);
    const creep = makeCreep([far, nearB, nearA]);

    assert.strictEqual(
        harness.role._test.findMostDepletedTowerBelowMaintenanceReserve(creep),
        nearA,
        'equal-energy towers should prefer range, then stable id order'
    );
})();

(function testMaintenanceReserveThreshold() {
    const harness = loadLorryHarness();
    const atReserve = makeTower('tower-at-reserve', 600, 1);
    const justBelow = makeTower('tower-below-reserve', 599, 5);
    const creep = makeCreep([atReserve, justBelow]);

    assert.strictEqual(
        harness.role._test.findMostDepletedTowerBelowMaintenanceReserve(creep),
        justBelow,
        '599-energy tower should qualify while 600-energy tower should not'
    );
    assert.strictEqual(
        harness.role._test.findMostDepletedTowerBelowMaintenanceReserve(makeCreep([atReserve])),
        undefined
    );
})();

(function testLowTowerOverridesStorageRebalanceDelivery() {
    const harness = loadLorryHarness();
    const storage = {id: 'storage', structureType: 'storage'};
    const weakestTower = makeTower('tower-weak', 50, 4);
    const creep = makeCreep([weakestTower], storage);

    harness.role.run(creep);
    assert.strictEqual(
        creep.transferredTo,
        weakestTower,
        'a tower below maintenance reserve should be refilled before storage rebalance'
    );
})();

(function testStorageRebalanceResumesWhenTowersReachReserve() {
    const harness = loadLorryHarness();
    const storage = {id: 'storage', structureType: 'storage'};
    const towerAtReserve = makeTower('tower-safe', 600, 1);
    const creep = makeCreep([towerAtReserve], storage);

    harness.role.run(creep);
    assert.strictEqual(
        creep.transferredTo,
        storage,
        'storage rebalance should resume once every tower has the maintenance reserve'
    );
})();

console.log('lorry tower-priority tests passed');
