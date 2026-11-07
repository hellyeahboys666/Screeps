'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'role.remoteLorry.js'), 'utf8');
const sandbox = {
    module: {exports: {}},
    exports: {},
    require(name) {
        if (name == 'energy.fallback' || name == 'energy.reserve'
            || name == 'remote.danger' || name == 'remote.build.depot') {
            return {};
        }
        throw new Error(`unexpected require: ${name}`);
    },
    RESOURCE_ENERGY: 'energy',
    FIND_MY_STRUCTURES: 'myStructures',
    STRUCTURE_TOWER: 'tower'
};
vm.runInNewContext(source, sandbox, {filename: 'role.remoteLorry.js'});
const api = sandbox.module.exports._test;

assert.ok(api, 'remote lorry should expose focused tower-priority helpers');

function makeStructure(id, structureType, energy, range) {
    return {
        id,
        structureType,
        range,
        store: {
            getUsedCapacity(resource) {
                assert.strictEqual(resource, 'energy');
                return energy;
            },
            getFreeCapacity(resource) {
                assert.strictEqual(resource, 'energy');
                return Math.max(0, 1000 - energy);
            }
        }
    };
}

function makeCreep(structures) {
    return {
        room: {
            find(type, options) {
                assert.strictEqual(type, 'myStructures');
                return structures.filter(options.filter);
            }
        },
        pos: {
            getRangeTo(target) { return target.range; },
            findClosestByPath() {
                throw new Error('low-reserve tower priority should bypass the ordinary sink path search');
            },
            findClosestByRange() {
                throw new Error('low-reserve tower priority should bypass the ordinary sink range search');
            }
        }
    };
}

(function testReturningRemoteLorryUsesWeakestTowerBeforeCloserSink() {
    const weakestTower = makeStructure('tower-weakest', 'tower', 100, 8);
    const closerTower = makeStructure('tower-closer', 'tower', 450, 1);
    const closerSpawn = makeStructure('spawn', 'spawn', 0, 1);
    const creep = makeCreep([closerSpawn, closerTower, weakestTower]);

    assert.strictEqual(
        api.findHomeEnergySink(creep),
        weakestTower,
        'returning remote lorries should deliver to the lowest-energy tower before ordinary home sinks'
    );
})();

(function testRemoteLorryReserveThresholdIsExclusive() {
    const atReserve = makeStructure('tower-safe', 'tower', 600, 1);
    const belowReserve = makeStructure('tower-low', 'tower', 599, 9);
    const creep = makeCreep([atReserve, belowReserve]);

    assert.strictEqual(
        api.findMostDepletedTowerBelowMaintenanceReserve(creep),
        belowReserve,
        'remote lorries should consider only towers below the 600-energy reserve'
    );
})();

console.log('remote-lorry tower-priority tests passed');
