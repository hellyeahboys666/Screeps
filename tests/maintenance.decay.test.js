'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'maintenance.decay.js'), 'utf8');

function load(objects) {
    const sandbox = {
        module: {exports: {}},
        Game: {time: 1, getObjectById: (id) => objects[id] || null},
        STRUCTURE_ROAD: 'road', STRUCTURE_CONTAINER: 'container', STRUCTURE_RAMPART: 'rampart',
        STRUCTURE_TOWER: 'tower', FIND_STRUCTURES: 'structures', FIND_MY_STRUCTURES: 'myStructures',
        RESOURCE_ENERGY: 'energy', WORK: 'work', OK: 0, ERR_NOT_IN_RANGE: -9
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(source, sandbox, {filename: 'maintenance.decay.js'});
    return {api: sandbox.module.exports, sandbox: sandbox};
}

function pos(x, y, roomName) {
    return {x: x, y: y, roomName: roomName || 'E1S1',
        isEqualTo: function(other) { return other.x === x && other.y === y && other.roomName === this.roomName; }};
}

function makeRoom(structures, opts) {
    opts = opts || {};
    return {
        name: opts.name || 'E1S1',
        controller: opts.controller === undefined ? {my: true, level: 2} : opts.controller,
        find: function(type, options) {
            const pool = type === 'myStructures' ? structures.filter((s) => s.my) : structures;
            return pool.filter(options.filter);
        }
    };
}

function makeCreep(room, energy, work, repairs, moves) {
    return {
        room: room, memory: {}, pos: Object.assign(pos(10, 10), {
            findClosestByRange: (list) => list[0]
        }),
        store: {getUsedCapacity: () => energy},
        getActiveBodyparts: () => work,
        repair: function(target) { repairs.push(target.id); return target.inRange === false ? -9 : 0; },
        moveTo: function(target) { moves.push(target.id); return 0; }
    };
}

(function testTowerlessRoomNeedsCreepRepairButFueledTowerRoomDoesNot() {
    const {api} = load({});
    assert.strictEqual(api.needsCreepRepair(makeRoom([])), true);
    const tower = {structureType: 'tower', my: true, isActive: () => true, store: {getUsedCapacity: () => 1000}};
    assert.strictEqual(api.needsCreepRepair(makeRoom([tower], {name: 'E2S2'})), false);
    const starved = {structureType: 'tower', my: true, isActive: () => true, store: {getUsedCapacity: () => 100}};
    assert.strictEqual(api.needsCreepRepair(makeRoom([starved], {name: 'E3S3'})), true,
        'a tower below its repair reserve does not repair, so creeps must');
    assert.strictEqual(api.needsCreepRepair(makeRoom([], {name: 'E4S4', controller: null})), true,
        'remote rooms need creeps');
})();

(function testCriticalOnlyWhileSitesWaitThenTopsUp() {
    const road = {id: 'road', structureType: 'road', hits: 2000, hitsMax: 5000, pos: pos(11, 10)};
    const container = {id: 'container', structureType: 'container', hits: 50000, hitsMax: 250000, pos: pos(12, 10)};
    const objects = {road: road, container: container};
    const {api, sandbox} = load(objects);
    const repairs = [], moves = [];
    const room = makeRoom([road, container]);
    const creep = makeCreep(room, 50, 2, repairs, moves);

    // Critical pass: only the container (20%) qualifies, not the road (40%).
    assert.strictEqual(api.run(creep, api.CRITICAL_RATIO), true);
    assert.deepStrictEqual(repairs, ['container']);
    assert.strictEqual(creep.memory.decayRepairId, 'container');

    // Sticky: keeps the container until 90% even though it is now above 25%.
    container.hits = 150000;
    sandbox.Game.time++;
    assert.strictEqual(api.run(creep, api.CRITICAL_RATIO), true);
    assert.deepStrictEqual(repairs, ['container', 'container']);

    container.hits = 230000;
    sandbox.Game.time++;
    assert.strictEqual(api.run(creep, api.CRITICAL_RATIO), false,
        'a restored target is released and nothing else is critical');
    assert.strictEqual(api.run(creep, api.REPAIR_RATIO), true, 'with no sites the 40% road is repaired');
    assert.deepStrictEqual(repairs.slice(-1), ['road']);
})();

(function testRampartUsesAbsoluteFloorAndCreepWithoutEnergyOrWorkDoesNothing() {
    const fresh = {id: 'fresh', structureType: 'rampart', my: true, hits: 1, hitsMax: 300000000, pos: pos(9, 9)};
    const healthy = {id: 'healthy', structureType: 'rampart', my: true, hits: 50000, hitsMax: 300000000, pos: pos(8, 8)};
    const {api} = load({fresh: fresh, healthy: healthy});
    const room = makeRoom([healthy, fresh]);
    const repairs = [], moves = [];
    assert.strictEqual(api.run(makeCreep(room, 0, 2, repairs, moves), 0.25), false);
    assert.strictEqual(api.run(makeCreep(room, 50, 0, repairs, moves), 0.25), false);
    assert.strictEqual(api.run(makeCreep(room, 50, 2, repairs, moves), 0.25), true);
    assert.deepStrictEqual(repairs, ['fresh'], 'a 1-hit rampart is critical; a 50k one is not');
})();

(function testOutOfRangeMovesToTarget() {
    const road = {id: 'road', structureType: 'road', hits: 100, hitsMax: 5000, pos: pos(30, 30), inRange: false};
    const {api} = load({road: road});
    const repairs = [], moves = [];
    assert.strictEqual(api.run(makeCreep(makeRoom([road]), 50, 1, repairs, moves), 0.25), true);
    assert.deepStrictEqual(moves, ['road']);
})();

(function testHarvesterPatchesOwnContainerWithHysteresis() {
    const {api} = load({});
    const container = {id: 'c', structureType: 'container', hits: 100000, hitsMax: 250000, pos: pos(10, 10)};
    const repairs = [], moves = [];
    const creep = makeCreep(makeRoom([container]), 20, 5, repairs, moves);
    assert.strictEqual(api.repairOwnContainer(creep, container), true, '40% container gets repaired');
    container.hits = 150000; // 60%: above the 50% start, below the 90% restore
    assert.strictEqual(api.repairOwnContainer(creep, container), true, 'keeps going until restored');
    container.hits = 230000;
    assert.strictEqual(api.repairOwnContainer(creep, container), false);
    container.hits = 150000;
    assert.strictEqual(api.repairOwnContainer(creep, container), false, 'does not restart above 50%');
    const off = {id: 'off', structureType: 'container', hits: 10, hitsMax: 250000, pos: pos(11, 10)};
    assert.strictEqual(api.repairOwnContainer(creep, off), false, 'only the container it stands on');
    assert.strictEqual(api.repairOwnContainer(makeCreep(makeRoom([]), 0, 5, repairs, moves), container), false);
})();

console.log('maintenance decay tests passed');
