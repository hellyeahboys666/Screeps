'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dangerSource = fs.readFileSync(path.join(root, 'remote.danger.js'), 'utf8');
const routeSafetySource = fs.readFileSync(path.join(root, 'remote.route.safety.js'), 'utf8');
const remoteBuildSource = fs.readFileSync(path.join(root, 'manager.remoteBuild.js'), 'utf8');

function makeHostile(parts, username) {
    return {
        owner: {username: username || 'Enemy'},
        getActiveBodyparts: function(part) {
            return parts[part] || 0;
        }
    };
}

function makeHostileRoom(getHostiles) {
    return {
        find: function(type, options) {
            assert.strictEqual(type, 'hostileCreeps');
            return getHostiles().filter(options.filter);
        }
    };
}

function loadRemoteDanger() {
    const sandbox = {
        module: {exports: {}},
        exports: {},
        global: {},
        FIND_HOSTILE_CREEPS: 'hostileCreeps',
        ATTACK: 'attack',
        RANGED_ATTACK: 'ranged_attack',
        WORK: 'work',
        CLAIM: 'claim'
    };
    vm.runInNewContext(dangerSource, sandbox, {filename: 'remote.danger.js'});
    return sandbox.module.exports;
}

function loadRouteSafety(remoteDanger, game, memory, globals) {
    const sandbox = {
        module: {exports: {}},
        exports: {},
        require: function(name) {
            if (name == 'remote.danger') {
                return remoteDanger;
            }
            throw new Error('unexpected require: ' + name);
        },
        Game: game,
        Memory: memory,
        global: globals,
        FIND_MY_STRUCTURES: 'myStructures',
        STRUCTURE_OBSERVER: 'observer',
        ERR_NOT_FOUND: -5
    };
    vm.runInNewContext(routeSafetySource, sandbox, {filename: 'remote.route.safety.js'});
    return sandbox.module.exports;
}

(function testOnlyAttackAndRangedHostilesActivateRouteDanger() {
    const remoteDanger = loadRemoteDanger();
    const attackOnly = makeHostile({attack: 1});
    const rangedOnly = makeHostile({ranged_attack: 1});
    const workOnly = makeHostile({work: 1});
    const healOnly = makeHostile({heal: 1});
    const alliedAttacker = makeHostile({attack: 1}, 'MoMoCat');
    const room = makeHostileRoom(function() {
        return [attackOnly, rangedOnly, workOnly, healOnly, alliedAttacker];
    });

    assert.strictEqual(remoteDanger.getAttackingHostileCount(room), 2,
        'only non-ally ATTACK/RANGED_ATTACK hostiles should block a conditional route');
})();

(function testRouteSafetyTransitionsAndObserverScheduling() {
    const remoteDanger = loadRemoteDanger();
    let visibleHostiles = [makeHostile({attack: 1})];
    const routeRoom = makeHostileRoom(function() { return visibleHostiles; });
    const game = {
        time: 100,
        rooms: {E8S18: routeRoom}
    };
    const memory = {};
    const globals = {};
    const routeSafety = loadRouteSafety(remoteDanger, game, memory, globals);

    let evaluated = routeSafety.evaluate(['E7S18'], ['E8S18']);
    assert.deepStrictEqual(Array.from(evaluated.activeAvoidRooms), ['E7S18', 'E8S18'],
        'an ATTACK-only hostile must activate the conditional route block');
    assert.strictEqual(evaluated.rooms.E8S18.safe, false);
    assert.strictEqual(evaluated.rooms.E8S18.attackingHostiles, 1);
    assert.strictEqual(memory.remoteBuildRouteSafety.E8S18.lastSeen, 100);

    game.time++;
    visibleHostiles = [makeHostile({ranged_attack: 1})];
    evaluated = routeSafety.evaluate([], ['E8S18']);
    assert.deepStrictEqual(Array.from(evaluated.activeAvoidRooms), ['E8S18'],
        'a RANGED_ATTACK-only hostile must keep the conditional route blocked');
    assert.strictEqual(evaluated.rooms.E8S18.safe, false);

    game.time++;
    visibleHostiles = [makeHostile({work: 1})];
    evaluated = routeSafety.evaluate([], ['E8S18']);
    assert.deepStrictEqual(Array.from(evaluated.activeAvoidRooms), [],
        'a visible route room must be released after ATTACK/RANGED danger clears');
    assert.strictEqual(evaluated.rooms.E8S18.safe, true);
    assert.strictEqual(memory.remoteBuildRouteSafety.E8S18.lastSeen, 102);

    game.time++;
    delete game.rooms.E8S18;
    evaluated = routeSafety.evaluate([], ['E8S18']);
    assert.deepStrictEqual(Array.from(evaluated.activeAvoidRooms), [],
        'an unseen room should retain its last observed safe state rather than reverting to a static block');
    assert.strictEqual(evaluated.rooms.E8S18.visible, false);
    assert.strictEqual(evaluated.rooms.E8S18.safe, true);

    let observedRoom;
    const observer = {
        id: 'observer1',
        structureType: 'observer',
        observeRoom: function(roomName) {
            observedRoom = roomName;
            return 0;
        }
    };
    const home = {
        name: 'E9S18',
        find: function(type, options) {
            assert.strictEqual(type, 'myStructures');
            return [observer].filter(options.filter);
        }
    };
    const firstObservation = routeSafety.observeRooms(home, ['E8S18', 'E7S18']);
    const secondObservation = routeSafety.observeRooms(home, ['E8S18', 'E7S18']);
    assert.strictEqual(observedRoom, 'E7S18',
        'observer scheduling should rotate conditional rooms by Game.time');
    assert.strictEqual(firstObservation, secondObservation,
        'only one observer intent should be issued per home room per tick');
    assert.strictEqual(memory.remoteBuildRouteObserver.room, 'E7S18');
})();

function makeEnergyStore(energy) {
    return {
        getUsedCapacity: function(resource) {
            assert.strictEqual(resource, 'energy');
            return energy;
        }
    };
}

function loadRemoteBuildHarness(options) {
    const depotPos = {x: 25, y: 25, roomName: 'E2S2'};
    const site = {
        my: true,
        structureType: options.depotContainerSite ? 'container' : 'spawn',
        pos: options.depotContainerSite ? depotPos : {x: 10, y: 10, roomName: 'E2S2'}
    };
    const homeRoom = {
        name: 'E0S0',
        terminal: {store: makeEnergyStore(50000), pos: {x: 20, y: 20, roomName: 'E0S0'}},
        find: function() { return []; }
    };
    const targetRoom = {
        name: 'E2S2',
        controller: {
            my: options.controllerMy == undefined ? true : options.controllerMy,
            level: options.controllerLevel == undefined ? 1 : options.controllerLevel
        },
        find: function(type, optionsArg) {
            if (type == 'hostileCreeps') return [];
            if (type == 'constructionSites') return [site];
            if (type == 'mySpawns') return options.hasSpawn ? [{my: true}] : [];
            throw new Error('unexpected target find: ' + type);
        },
        lookForAtArea: function() { return []; }
    };
    const routeSafety = {
        observeRooms: function() {},
        evaluate: function(staticAvoidRooms, conditionalAvoidRooms) {
            return {
                activeAvoidRooms: ['E8S18'],
                conditionalAvoidRooms: conditionalAvoidRooms,
                rooms: {E8S18: {safe: false, attackingHostiles: 1}}
            };
        }
    };
    const sandbox = {
        module: {exports: {}},
        exports: {},
        require: function(name) {
            if (name == 'remote.build.depot') {
                return {
                    resolveDepotPosition: function() {
                        return {pos: depotPos, source: 'test'};
                    }
                };
            }
            if (name == 'remote.route.safety') return routeSafety;
            throw new Error('unexpected require: ' + name);
        },
        Game: {
            time: 500,
            rooms: {E0S0: homeRoom, E2S2: targetRoom},
            creeps: options.creeps || {}
        },
        Memory: {
            remoteBuildMissions: {
                E2S2: {
                    home: 'E0S0',
                    target: 'E2S2',
                    depotPos: depotPos,
                    bodyProfile: 'offroad',
                    conditionalAvoidRooms: ['E8S18'],
                    stopCondition: options.stopCondition,
                    maxCarriers: 1,
                    maxBuilders: 1
                }
            }
        },
        RESOURCE_ENERGY: 'energy',
        FIND_HOSTILE_CREEPS: 'hostileCreeps',
        FIND_CONSTRUCTION_SITES: 'constructionSites',
        FIND_MY_SPAWNS: 'mySpawns',
        LOOK_RESOURCES: 'resources',
        LOOK_STRUCTURES: 'structures',
        STRUCTURE_SPAWN: 'spawn',
        STRUCTURE_TOWER: 'tower',
        STRUCTURE_EXTENSION: 'extension',
        STRUCTURE_CONTAINER: 'container',
        STRUCTURE_STORAGE: 'storage'
    };
    vm.runInNewContext(remoteBuildSource, sandbox, {filename: 'manager.remoteBuild.js'});
    return {
        remoteBuild: sandbox.module.exports,
        spawn: {name: 'Spawn1', room: homeRoom, memory: {}}
    };
}

(function testNewCarrierUsesEvaluatedConditionalAvoidance() {
    const harness = loadRemoteBuildHarness({depotContainerSite: false});
    const plan = harness.remoteBuild.getSpawnPlan(harness.spawn);

    assert.ok(plan.carrierRequest, 'the staged target should request its first carrier');
    assert.deepStrictEqual(Array.from(plan.carrierRequest.avoidRooms), ['E8S18'],
        'a new carrier must receive active conditional route avoidance, not only static avoids');
    assert.deepStrictEqual(Array.from(plan.carrierRequest.conditionalAvoidRooms), ['E8S18']);
})();

(function testNewBuilderUsesEvaluatedConditionalAvoidance() {
    const existingCarrier = {
        memory: {
            role: 'remoteCarrier',
            home: 'E0S0',
            target: 'E2S2',
            remoteBuildMission: 'E2S2'
        }
    };
    const harness = loadRemoteBuildHarness({
        depotContainerSite: true,
        creeps: {carrier: existingCarrier}
    });
    const plan = harness.remoteBuild.getSpawnPlan(harness.spawn);

    assert.ok(plan.builderRequest, 'a supplied depot container and carrier should request its first builder');
    assert.deepStrictEqual(Array.from(plan.builderRequest.avoidRooms), ['E8S18'],
        'a new builder must receive active conditional route avoidance, not only static avoids');
    assert.deepStrictEqual(Array.from(plan.builderRequest.conditionalAvoidRooms), ['E8S18']);
})();

(function testDefaultStopConditionRemainsRcl6() {
    const harness = loadRemoteBuildHarness({hasSpawn: true, controllerLevel: 5});
    const status = harness.remoteBuild.getSpawnPlan(harness.spawn).statuses[0];

    assert.strictEqual(status.stopCondition, 'rcl6');
    assert.strictEqual(status.remoteBuildComplete, false,
        'an unspecified mission must keep running after spawn construction until RCL6');
})();

(function testSpawnBuiltConditionStopsAtLowRcl() {
    const harness = loadRemoteBuildHarness({
        hasSpawn: true,
        controllerLevel: 1,
        stopCondition: 'spawnBuilt'
    });
    const plan = harness.remoteBuild.getSpawnPlan(harness.spawn);
    const status = plan.statuses[0];

    assert.strictEqual(status.stopCondition, 'spawnBuilt');
    assert.strictEqual(status.remoteBuildComplete, true);
    assert.strictEqual(status.completeReason, 'targetSpawnBuilt');
    assert.strictEqual(status.phase, 'completeSpawnBuilt');
    assert.strictEqual(status.desiredCarriers, 0);
    assert.strictEqual(status.desiredBuilders, 0);
    assert.strictEqual(plan.carrierRequest, undefined);
    assert.strictEqual(plan.builderRequest, undefined);
})();

(function testRcl6ConditionIgnoresEarlySpawnAndStopsAtRcl6() {
    const earlyHarness = loadRemoteBuildHarness({
        hasSpawn: true,
        controllerLevel: 1,
        stopCondition: 'rcl6'
    });
    const earlyStatus = earlyHarness.remoteBuild.getSpawnPlan(earlyHarness.spawn).statuses[0];
    assert.strictEqual(earlyStatus.remoteBuildComplete, false);

    const completeHarness = loadRemoteBuildHarness({
        hasSpawn: true,
        controllerLevel: 6,
        stopCondition: 'rcl6'
    });
    const completeStatus = completeHarness.remoteBuild.getSpawnPlan(completeHarness.spawn).statuses[0];
    assert.strictEqual(completeStatus.remoteBuildComplete, true);
    assert.strictEqual(completeStatus.completeReason, 'targetRcl6');
    assert.strictEqual(completeStatus.phase, 'completeRcl6');
})();

(function testForeignRcl6DoesNotReportMissionCompletionReason() {
    const harness = loadRemoteBuildHarness({
        controllerMy: false,
        controllerLevel: 6,
        stopCondition: 'rcl6'
    });
    const status = harness.remoteBuild.getSpawnPlan(harness.spawn).statuses[0];

    assert.strictEqual(status.remoteBuildComplete, false);
    assert.strictEqual(status.completeReason, undefined);
})();

function loadCompletedRole(fileName, status) {
    const source = fs.readFileSync(path.join(root, fileName), 'utf8');
    const sandbox = {
        module: {exports: {}},
        exports: {},
        require: function(name) {
            if (name == 'remote.danger' || name == 'remote.build.depot'
                || name == 'maintenance.decay') return {};
            throw new Error('unexpected require: ' + name);
        },
        Memory: {remoteBuildMissionStatus: {mission: status}},
        RESOURCE_ENERGY: 'energy',
        RIGHT: 3,
        LEFT: 7,
        TOP: 1,
        BOTTOM: 5,
        OK: 0
    };
    vm.runInNewContext(source, sandbox, {filename: fileName});
    return sandbox.module.exports;
}

function makeCompletedMissionCreep(role) {
    const spoken = [];
    return {
        memory: {
            role: role,
            home: 'E0S0',
            target: 'E2S2',
            remoteBuildMission: 'mission',
            avoidRooms: [],
            conditionalAvoidRooms: ['E8S18'],
            depotPos: {x: 25, y: 25, roomName: 'E2S2'}
        },
        room: {name: 'E0S0'},
        pos: {x: 25, y: 25},
        fatigue: 0,
        store: {getUsedCapacity: function() { return 0; }},
        say: function(message) { spoken.push(message); },
        spoken: spoken
    };
}

(function testCompletedSpawnBuiltRolesRetireWithAccurateReason() {
    const status = {
        home: 'E0S0',
        target: 'E2S2',
        remoteBuildComplete: true,
        completeReason: 'targetSpawnBuilt'
    };
    const builder = makeCompletedMissionCreep('remoteBuilder');
    const carrier = makeCompletedMissionCreep('remoteCarrier');

    loadCompletedRole('role.remoteBuilder.js', status).run(builder);
    loadCompletedRole('role.remoteCarrier.js', status).run(carrier);

    assert.strictEqual(builder.memory.role, 'builder');
    assert.strictEqual(carrier.memory.role, 'lorry');
    assert.deepStrictEqual(builder.spoken, ['spawn']);
    assert.deepStrictEqual(carrier.spoken, ['spawn']);
    assert.strictEqual(builder.memory.conditionalAvoidRooms, undefined);
    assert.strictEqual(carrier.memory.conditionalAvoidRooms, undefined);
})();

console.log('remote route safety tests passed');
