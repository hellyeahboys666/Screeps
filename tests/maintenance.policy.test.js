'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const repairerSource = fs.readFileSync(path.join(root, 'role.repairer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadRepairerHarness() {
    let upgraderRuns = 0;
    const workPositionCalls = [];
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: {
            spawns: {
                Spawn1: {
                    room: {name: 'E0S0'},
                    memory: {rampartTargetHits: 100000}
                }
            }
        },
        RESOURCE_ENERGY: 'energy',
        FIND_MY_STRUCTURES: 'myStructures',
        FIND_DROPPED_RESOURCES: 'droppedResources',
        FIND_STRUCTURES: 'structures',
        FIND_SOURCES_ACTIVE: 'activeSources',
        STRUCTURE_RAMPART: 'rampart',
        STRUCTURE_WALL: 'wall',
        STRUCTURE_CONTAINER: 'container',
        STRUCTURE_STORAGE: 'storage',
        ERR_NOT_IN_RANGE: -9,
        OK: 0,
        require: function(name) {
            if (name === 'role.upgrader') {
                return {run: function() { upgraderRuns++; }};
            }
            if (name === 'energy.fallback') {
                return {
                    withdrawFromPreferredWorkerStore: function() { return false; },
                    pickupSpawnDropPile: function() { return false; },
                    isSpawnDropPile: function() { return false; }
                };
            }
            if (name === 'remote.build.depot') {
                return {isRemoteBuildDepotEnergyStructure: function() { return false; }};
            }
            if (name === 'work.position') {
                return {
                    moveToWorkTarget: function() { workPositionCalls.push('move'); },
                    holdWorkPosition: function() { workPositionCalls.push('hold'); }
                };
            }
            throw new Error('unexpected require: ' + name);
        }
    };
    vm.runInNewContext(repairerSource, sandbox, {filename: 'role.repairer.js'});
    return {
        roleRepairer: sandbox.module.exports,
        getUpgraderRuns: function() { return upgraderRuns; },
        workPositionCalls: workPositionCalls
    };
}

function makeRepairer(room, repaired) {
    return {
        carry: {energy: 100},
        carryCapacity: 100,
        memory: {},
        room: room,
        pos: {
            findClosestByRange: function() { return undefined; },
            findClosestByPath: function() { return undefined; }
        },
        repair: function(target) {
            repaired.push(target.id);
            return 0;
        }
    };
}

function loadMainMaintenanceHarness() {
    const creepCounts = {
        applyRcl7CreepCountTargets: function(rcl, targets) {
            return {targets: Object.assign({}, targets), active: false, scale: 1, overrides: {}};
        }
    };
    const remoteMining = {
        updateDefaultRemoteLorryAutoTarget: function() {}
    };
    const sandbox = {
        module: {exports: {}},
        exports: {},
        Game: {time: 1, spawns: {}, creeps: {}, rooms: {}},
        Memory: {},
        global: {},
        console: console,
        RESOURCE_ENERGY: 'energy',
        RESOURCE_CATALYZED_GHODIUM_ALKALIDE: 'XGHO2',
        RESOURCE_CATALYZED_KEANIUM_ALKALIDE: 'XKHO2',
        RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE: 'XLHO2',
        RESOURCE_CATALYZED_LEMERGIUM_ACID: 'XLH2O',
        TOUGH: 'tough',
        RANGED_ATTACK: 'ranged_attack',
        HEAL: 'heal',
        FIND_MY_STRUCTURES: 'myStructures',
        FIND_STRUCTURES: 'structures',
        FIND_MY_CREEPS: 'myCreeps',
        FIND_MY_SPAWNS: 'mySpawns',
        STRUCTURE_WALL: 'wall',
        STRUCTURE_RAMPART: 'rampart',
        STRUCTURE_ROAD: 'road',
        STRUCTURE_CONTAINER: 'container',
        OK: 0,
        require: function(name) {
            if (name === 'prototype.spawn') {
                return function() {};
            }
            if (name === 'movement') {
                return {install: function() {}};
            }
            if (name === 'creep.counts') {
                return creepCounts;
            }
            if (name === 'manager.remoteMining') {
                return remoteMining;
            }
            return {};
        }
    };
    const exportsForTest = '\nmodule.exports.__maintenanceTest = {'
        + 'isTowerMaintenanceTarget: isTowerMaintenanceTarget,'
        + 'getRoomTowerMaintenanceTargets: getRoomTowerMaintenanceTargets,'
        + 'shouldTowerPerformMaintenance: shouldTowerPerformMaintenance,'
        + 'shouldTowerPerformRampartMaintenance: typeof shouldTowerPerformRampartMaintenance === "function" ? shouldTowerPerformRampartMaintenance : undefined,'
        + 'updateRampartRepairStatus: updateRampartRepairStatus,'
        + 'runTowerDefense: runTowerDefense,'
        + 'applyRclCreepCountTargets: applyRclCreepCountTargets'
        + '};\n';
    vm.runInNewContext(mainSource + exportsForTest, sandbox, {filename: 'main.js'});
    return {api: sandbox.module.exports.__maintenanceTest, sandbox: sandbox};
}

function makeTower(energy, repairs) {
    return {
        store: {
            getUsedCapacity: function(resource) {
                assert.strictEqual(resource, 'energy');
                return energy;
            }
        },
        repair: function(target) {
            repairs.push(target.id);
            return 0;
        }
    };
}

function makeRoom(level, structures) {
    return {
        name: 'E0S0',
        controller: {my: true, level: level},
        memory: {},
        find: function(type, options) {
            assert.strictEqual(type, 'structures');
            return structures.filter(options.filter);
        }
    };
}

(function testRepairersOnlyRepairRampartsBelowTarget() {
    const road = {id: 'road', structureType: 'road', hits: 100, hitsMax: 5000};
    const highRampart = {id: 'highRampart', structureType: 'rampart', hits: 100000, hitsMax: 300000000};
    const lowRampart = {id: 'lowRampart', structureType: 'rampart', hits: 50000, hitsMax: 300000000};
    const room = {
        name: 'E0S0',
        find: function(type, options) {
            assert.strictEqual(type, 'myStructures');
            return [road, highRampart, lowRampart].filter(options.filter);
        }
    };
    const harness = loadRepairerHarness();
    const repaired = [];
    harness.roleRepairer.run(makeRepairer(room, repaired));
    assert.deepStrictEqual(repaired, ['lowRampart']);
    assert.deepStrictEqual(harness.workPositionCalls, ['hold']);
    assert.strictEqual(harness.getUpgraderRuns(), 0);
    assert.doesNotMatch(repairerSource, /isNonRampartRepairTarget|isUrgentNonRampartRepairTarget|NON_RAMPART_URGENT_REPAIR_RATIO/);
})();

(function testExistingRepairerUpgradesWhenNoRampartNeedsWork() {
    const room = {
        name: 'E0S0',
        find: function(type, options) {
            assert.strictEqual(type, 'myStructures');
            return [].filter(options.filter);
        }
    };
    const harness = loadRepairerHarness();
    const repaired = [];
    harness.roleRepairer.run(makeRepairer(room, repaired));
    assert.deepStrictEqual(repaired, []);
    assert.strictEqual(harness.getUpgraderRuns(), 1);
})();

(function testTowerMaintenancePolicy() {
    const harness = loadMainMaintenanceHarness();
    const api = harness.api;
    const damagedRoad = {id: 'road', structureType: 'road', hits: 400, hitsMax: 5000};
    const damagedContainer = {id: 'container', structureType: 'container', hits: 100000, hitsMax: 250000};
    const damagedExtension = {id: 'extension', structureType: 'extension', my: true, hits: 800, hitsMax: 1000};
    const hostileExtension = {id: 'hostileExtension', structureType: 'extension', my: false, hits: 100, hitsMax: 1000};
    const damagedWall = {id: 'wall', structureType: 'wall', my: true, hits: 1, hitsMax: 300000000};
    const damagedRampart = {id: 'rampart', structureType: 'rampart', my: true, hits: 2500, hitsMax: 300000000};
    const room6 = makeRoom(6, [damagedExtension, hostileExtension, damagedWall, damagedRampart, damagedContainer, damagedRoad]);
    const room5 = makeRoom(5, [damagedRoad]);

    assert.strictEqual(api.isTowerMaintenanceTarget(damagedRoad), true);
    assert.strictEqual(api.isTowerMaintenanceTarget(damagedContainer), true);
    assert.strictEqual(api.isTowerMaintenanceTarget(damagedExtension), true);
    assert.strictEqual(api.isTowerMaintenanceTarget(hostileExtension), false);
    assert.deepStrictEqual(
        api.getRoomTowerMaintenanceTargets(room6).map(function(structure) { return structure.id; }),
        ['road', 'container', 'extension']
    );
    assert.strictEqual(api.getRoomTowerMaintenanceTargets(room5).length, 0);
    assert.strictEqual(api.shouldTowerPerformMaintenance(room5, makeTower(1000, []), damagedRoad, []), false);
    assert.strictEqual(api.shouldTowerPerformMaintenance(room6, makeTower(599, []), damagedRoad, []), false);
    assert.strictEqual(api.shouldTowerPerformMaintenance(room6, makeTower(600, []), damagedRoad, []), true);
    assert.strictEqual(api.shouldTowerPerformMaintenance(room6, makeTower(1000, []), damagedRoad, [{}]), false);

    const rampartRepairs = [];
    const summaryWithDecayBuffer = api.runTowerDefense(
        room6,
        [makeTower(1000, rampartRepairs)],
        [],
        [damagedRampart],
        []
    );
    assert.deepStrictEqual(rampartRepairs, ['rampart']);
    assert.strictEqual(summaryWithDecayBuffer.action, 'repairRampart');

    harness.sandbox.Game.time++;
    const maintenanceRepairs = [];
    const summaryMaintenance = api.runTowerDefense(
        room6,
        [makeTower(1000, maintenanceRepairs)],
        [],
        [],
        []
    );
    assert.deepStrictEqual(maintenanceRepairs, ['road']);
    assert.strictEqual(summaryMaintenance.action, 'repairMaintenance');

    harness.sandbox.Game.time++;
    const lowRclRepairs = [];
    const summaryLowRcl = api.runTowerDefense(
        room5,
        [makeTower(1000, lowRclRepairs)],
        [],
        [],
        []
    );
    assert.deepStrictEqual(lowRclRepairs, []);
    assert.notStrictEqual(summaryLowRcl.action, 'repairMaintenance');
})();

(function testEstablishedRampartsUseTowerForNormalDecay() {
    const harness = loadMainMaintenanceHarness();
    const api = harness.api;
    const room = makeRoom(6, []);
    const spawn = {room: room, memory: {rampartTargetHits: 100000}};
    const rampart = {id: 'rampart', structureType: 'rampart', my: true, hits: 100000, hitsMax: 300000000};

    let policy = api.updateRampartRepairStatus(spawn, [rampart], [], true);
    assert.strictEqual(policy.targetEstablished, true,
        'the room should latch steady-state maintenance after every current rampart reaches target');

    rampart.hits = 99700;
    policy = api.updateRampartRepairStatus(spawn, [rampart], [rampart], true);
    assert.strictEqual(policy.repairerRamparts.length, 0,
        'one normal decay step below target must not spawn another repairer');
    assert.deepStrictEqual(Array.from(policy.towerMaintenanceRamparts), [rampart]);
    assert.strictEqual(api.shouldTowerPerformRampartMaintenance(
        room, makeTower(600, []), rampart, []), true);

    const repairs = [];
    const summary = api.runTowerDefense(
        room,
        [makeTower(1000, repairs)],
        [],
        [],
        [],
        policy.towerMaintenanceRamparts
    );
    assert.deepStrictEqual(repairs, ['rampart']);
    assert.strictEqual(summary.action, 'repairRampartMaintenance');
})();

(function testLargePostTargetDeficitRestartsRepairer() {
    const harness = loadMainMaintenanceHarness();
    const api = harness.api;
    const room = makeRoom(6, []);
    const spawn = {room: room, memory: {rampartTargetHits: 100000}};
    const rampart = {id: 'rampart', structureType: 'rampart', my: true, hits: 100000, hitsMax: 300000000};

    api.updateRampartRepairStatus(spawn, [rampart], [], true);
    rampart.hits = 94999;
    const policy = api.updateRampartRepairStatus(spawn, [rampart], [rampart], true);

    assert.strictEqual(policy.repairerRestartHits, 95000);
    assert.deepStrictEqual(Array.from(policy.repairerRamparts), [rampart],
        'falling below 95% of target should permit a dedicated repairer again');
})();

(function testNewRampartResetsEstablishedMaintenanceLatch() {
    const harness = loadMainMaintenanceHarness();
    const api = harness.api;
    const room = makeRoom(6, []);
    const spawn = {room: room, memory: {rampartTargetHits: 100000}};
    const established = {id: 'established', structureType: 'rampart', my: true, hits: 100000, hitsMax: 300000000};
    const newRampart = {id: 'new', structureType: 'rampart', my: true, hits: 1, hitsMax: 300000000};

    api.updateRampartRepairStatus(spawn, [established], [], true);
    const policy = api.updateRampartRepairStatus(
        spawn, [newRampart, established], [newRampart], true);

    assert.strictEqual(policy.targetEstablished, false);
    assert.deepStrictEqual(Array.from(policy.repairerRamparts), [newRampart],
        'a newly built rampart still needs initial dedicated buildup');
})();

(function testNoTowerKeepsRepairerGateActive() {
    const harness = loadMainMaintenanceHarness();
    const api = harness.api;
    const room = makeRoom(5, []);
    const spawn = {room: room, memory: {rampartTargetHits: 100000}};
    const rampart = {id: 'rampart', structureType: 'rampart', my: true, hits: 100000, hitsMax: 300000000};

    api.updateRampartRepairStatus(spawn, [rampart], [], false);
    rampart.hits = 99700;
    const policy = api.updateRampartRepairStatus(spawn, [rampart], [rampart], false);

    assert.deepStrictEqual(Array.from(policy.repairerRamparts), [rampart],
        'rooms without tower maintenance must retain the ordinary repairer gate');
})();

(function testAutoTargetsDoNotKeepStandingRepairers() {
    const harness = loadMainMaintenanceHarness();
    const spawn = {
        memory: {creepCountMode: 'autoByRCL'},
        room: {controller: {level: 6}, memory: {}}
    };
    harness.api.applyRclCreepCountTargets(spawn, 2, true, true, false, false, false, false, 0);
    assert.strictEqual(spawn.memory.minRepairers, 0);
    assert.match(
        mainSource,
        /rampartRepairPolicy\.repairerRamparts\.length\s*>\s*0[\s\S]{0,800}createCustomCreep\(energy,\s*'repairer'/
    );
    assert.match(mainSource, /RAMPART_REPAIRER_RESTART_RATIO\s*=\s*0\.95/);
    assert.match(mainSource, /repairRampartMaintenance/);
    assert.doesNotMatch(mainSource, /else\s+if\s*\(nR\s*<\s*spawn\.memory\.minRepairers\)/);
})();

console.log('maintenance policy tests passed');
