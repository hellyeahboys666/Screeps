'use strict';
// Read-only offline probes. Synthetic edge cases below are NOT MMO captures.
// Bug assertions deliberately preserve observed failures; this is not a green
// acceptance suite for fixed gameplay. No Screeps connection or live writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const files = ['base.builder.executor.js', 'manager.baseBuilder.js', 'base.builder.runtime.js',
    'manager.firstSpawn.js', 'base.builder.firstSpawnRuntime.js', 'main.js',
    'role.builder.js', 'role.harvester.js', 'role.upgrader.js', 'creep.counts.js'];
const report = {scope: 'offline VM intent probes; no engine settlement or live writes',
    sourceSha256: {}, probes: []};
for (const file of files) report.sourceSha256[file] = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex');
function base() {
    const s = {Game: {time: 1000, cpu: {bucket: 10000}, constructionSites: {}, spawns: {}, rooms: {}, creeps: {}, flags: {}},
        Memory: {baseBuilder: {}}, console, global: {}, TERRAIN_MASK_WALL: 1,
        MAX_CONSTRUCTION_SITES: 100, OK: 0, ERR_INVALID_TARGET: -7, ERR_RCL_NOT_ENOUGH: -14,
        ERR_NOT_IN_RANGE: -9, ERR_NOT_ENOUGH_RESOURCES: -6, COLOR_WHITE: 10,
        CONTROLLER_STRUCTURES: {spawn: {1: 1, 2: 1, 8: 3}, extension: {1: 0, 2: 5, 8: 60},
            container: {1: 5, 2: 5, 8: 5}, rampart: {1: 0, 2: 2500, 8: 2500}}};
    for (const k of ['FIND_MY_SPAWNS', 'FIND_STRUCTURES', 'FIND_CONSTRUCTION_SITES', 'FIND_SOURCES',
        'FIND_MINERALS', 'FIND_HOSTILE_CREEPS', 'FIND_HOSTILE_POWER_CREEPS', 'FIND_FLAGS',
        'FIND_MY_CREEPS', 'FIND_MY_STRUCTURES', 'FIND_DROPPED_RESOURCES', 'FIND_SOURCES_ACTIVE']) s[k] = k;
    for (const type of ['spawn', 'extension', 'tower', 'storage', 'container', 'link', 'rampart', 'road', 'wall']) {
        s['STRUCTURE_' + type.toUpperCase()] = type;
    }
    for (const part of ['WORK', 'CARRY', 'MOVE', 'TOUGH', 'HEAL', 'RANGED_ATTACK']) s[part] = part.toLowerCase();
    s.RESOURCE_ENERGY = 'energy';
    for (const k of ['CATALYZED_GHODIUM_ALKALIDE', 'CATALYZED_KEANIUM_ALKALIDE',
        'CATALYZED_LEMERGIUM_ALKALIDE', 'CATALYZED_LEMERGIUM_ACID']) s['RESOURCE_' + k] = k;
    return s;
}
function load(file, s, req, extra = '') {
    const context = vm.createContext(Object.assign({}, s, {module: {exports: {}}, exports: {},
        require: req || (() => { throw new Error('unexpected require'); })}));
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + extra, context, {filename: file});
    return context.module.exports;
}
function room(s, withSpawn = true) {
    const r = {name: 'E0S0', memory: {}, controller: {id: 'c', my: true, level: 2, pos: {x: 13, y: 10}},
        structures: [], sites: [], sources: [{id: 'src', pos: {x: 10, y: 13}}], minerals: [],
        hostiles: [], powerHostiles: [], flags: [], intents: []};
    r.spawns = withSpawn ? [{id: 'anchor', my: true, structureType: 'spawn', pos: {x: 10, y: 10}}] : [];
    r.structures.push(...r.spawns);
    r.find = function(kind) {
        return ({FIND_MY_SPAWNS: r.spawns, FIND_STRUCTURES: r.structures,
            FIND_CONSTRUCTION_SITES: r.sites, FIND_SOURCES: r.sources, FIND_MINERALS: r.minerals,
            FIND_HOSTILE_CREEPS: r.hostiles, FIND_HOSTILE_POWER_CREEPS: r.powerHostiles,
            FIND_FLAGS: r.flags})[kind] || [];
    };
    r.getTerrain = () => ({get: () => 0});
    r.createConstructionSite = (...args) => {r.intents.push(args); return s.OK;};
    s.Game.rooms[r.name] = r;
    return r;
}
function plan(r) {
    return {valid: true, blockers: [], anchorId: 'anchor', anchorPos: {x: 10, y: 10},
        entries: [{type: 'extension', pos: {x: 10, y: 11}, purpose: 'testExtension', priority: 1}]};
}
function readyState(r) {
    r.memory.baseBuilder = {mode: 'place', planVersion: 1, generatedTick: 1, plan: plan(r)};
}
function note(name, observation) {report.probes.push({name, observation});}

// Ordinary builder: hostile power creeps pause only their present tick.
{
    const s = base(), r = room(s); readyState(r);
    const executor = load('base.builder.executor.js', s);
    const manager = load('manager.baseBuilder.js', s);
    r.powerHostiles = [{owner: {username: 'Enemy'}}];
    assert.equal(manager.run(r, {executor}).status, 'paused');
    assert.equal(r.memory.baseBuilder.lastPlayerHostileTick, undefined);
    s.Game.time++; r.powerHostiles = [];
    assert.equal(manager.run(r, {executor}).status, 'placed');
    assert.equal(r.intents.length, 1);
    note('base-builder-power-hostile-cooldown-missing', {departureTickStatus: 'placed', intents: r.intents.length});
    // Positive control: ordinary player creep does establish the cooldown.
    const s2 = base(), r2 = room(s2); readyState(r2);
    const e2 = load('base.builder.executor.js', s2), m2 = load('manager.baseBuilder.js', s2);
    r2.hostiles = [{owner: {username: 'Enemy'}}]; m2.run(r2, {executor: e2});
    s2.Game.time++; r2.hostiles = [];
    assert.equal(m2.run(r2, {executor: e2}).status, 'paused');
    assert.equal(r2.intents.length, 0);
}

// Current executor validates occupancy but not changed source access.
{
    const s = base(), r = room(s); readyState(r);
    const open = new Set(['10,10', '10,11', '11,11', '10,12', '10,13', '11,10', '12,10', '13,10']);
    r.getTerrain = () => ({get: (x, y) => open.has(`${x},${y}`) ? 0 : 1});
    const manualWall = {id: 'manual', structureType: 'constructedWall', my: true, pos: {x: 11, y: 11}};
    r.structures.push(manualWall);
    function sourceReachable(extra = []) {
        const blocked = new Set(r.structures.concat(extra).map(o => `${o.pos.x},${o.pos.y}`));
        blocked.add('10,13');
        const queue = [{x: 10, y: 10}], seen = new Set(['10,10']);
        for (let i = 0; i < queue.length; i++) {
            const p = queue[i];
            if (Math.max(Math.abs(p.x - 10), Math.abs(p.y - 13)) <= 1) return true;
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const x = p.x + dx, y = p.y + dy, key = `${x},${y}`;
                if (!open.has(key) || blocked.has(key) || seen.has(key)) continue;
                seen.add(key); queue.push({x, y});
            }
        }
        return false;
    }
    assert.equal(sourceReachable(), true);
    assert.equal(sourceReachable([{pos: {x: 10, y: 11}}]), false);
    const result = load('base.builder.executor.js', s).execute(r, r.memory.baseBuilder.plan, {mode: 'place'});
    assert.equal(result.status, 'placed');
    note('stale-plan-can-seal-source-access', {sourceReachableBefore: true, sourceReachableAfterCompletion: false,
        executorStatus: result.status});
}

// First-spawn manager: controlled planner stub isolates pause/threat gates.
// This tests authorization flow, NOT candidate-layout correctness.
function firstReady(s, r) {
    const snapshot = {eligible: true, roomName: r.name, terrain: new Array(2500).fill(0),
        structures: [], sites: [], sources: r.sources, minerals: [], spawns: [], controller: r.controller};
    const candidate = {pos: {x: 20, y: 20}, score: 1};
    const deps = {survey: {survey: () => snapshot}, firstSpawn: {
        rankCandidates: () => ({candidates: [candidate]}),
        evaluateCandidate: () => ({valid: true, ...candidate, extensionCount: 60})}};
    const manager = load('manager.firstSpawn.js', s);
    const request = {target: r.name, home: 'E1S0', mode: 'place'};
    assert.equal(manager.run(r, request, deps).status, 'observing');
    s.Game.time++;
    return {manager, request, deps};
}
for (const pause of ['globalPauseUntil', 'roomPaused', 'roomPauseUntil']) {
    const s = base(), r = room(s, false), h = firstReady(s, r);
    if (pause === 'globalPauseUntil') s.Memory.baseBuilder.pauseUntil = s.Game.time + 100;
    if (pause === 'roomPaused') r.memory.baseBuilder.paused = true;
    if (pause === 'roomPauseUntil') r.memory.baseBuilder.pauseUntil = s.Game.time + 100;
    const result = h.manager.run(r, h.request, h.deps);
    assert.equal(result.status, 'placed');
    note('first-spawn-ignores-' + pause, {status: result.status, intents: r.intents.length});
}
{
    const s = base(), r = room(s, false), h = firstReady(s, r);
    r.hostiles = [{owner: {username: 'Invader'}}, {owner: {username: 'Enemy'}}];
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'paused');
    assert.equal(r.memory.baseBuilder.firstSpawn.lastPlayerHostileTick, undefined);
    r.hostiles = []; s.Game.time++;
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'placed');
    note('first-spawn-npc-hides-player-cooldown', {nextTickStatus: 'placed', playerSightingRecorded: false});
}
{
    const s = base(), r = room(s, false), h = firstReady(s, r);
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'placed');
    s.Game.time++;
    r.sites = [{id: 'confirmed', my: true, structureType: 'spawn', pos: {x: 20, y: 20}}];
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'existingSpawnSite');
    s.Game.time++; r.sites = [];
    r.memory = JSON.parse(JSON.stringify(r.memory));
    assert.equal(load('manager.firstSpawn.js', s).run(r, h.request, h.deps).status, 'awaitingSiteReadback');
    note('first-spawn-cancelled-acknowledged-site-stuck', {statusAfterCancellationAndReset: 'awaitingSiteReadback'});
}
{
    const s = base(), r = room(s, false), h = firstReady(s, r);
    r.spawns = [{id: 'manualSpawn', my: true, structureType: 'spawn', pos: {x: 21, y: 20}}];
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'alreadySpawned');
    r.spawns = []; s.Game.time++;
    assert.equal(h.manager.run(r, h.request, h.deps).status, 'placed');
    note('first-spawn-manual-completion-not-retired', {afterLaterSpawnLoss: 'placed'});
}

// Full role runs: carried energy is ignored during an emergency while refilling.
for (const role of ['builder', 'harvester', 'upgrader']) {
    const s = base(), calls = [];
    const r = {name: 'E0S0', controller: {my: true, level: 2, ticksToDowngrade: 1,
        pos: {findInRange: () => []}}, find: () => []};
    const source = {id: 'src', room: r, energy: 0};
    s.Game.getObjectById = () => source;
    const creep = {id: 'worker', name: 'worker', memory: {empty: true, role, sourceId: 'src'}, room: r,
        carry: {energy: 50}, carryCapacity: 100, getActiveBodyparts: () => 1,
        store: {getFreeCapacity: () => 50}, pos: {findClosestByPath: arg => arg === s.FIND_SOURCES_ACTIVE ? source : undefined,
            findClosestByRange: () => undefined, getRangeTo: () => 1},
        upgradeController: () => {calls.push('upgrade'); return 0;},
        harvest: () => {calls.push('harvestDepletedSource'); return -6;}, moveTo: () => {}, withdraw: () => 0};
    const deps = { 'energy.fallback': {withdrawFromPreferredWorkerStore: () => false,
        pickupSpawnDropPile: () => false, isSpawnDropPile: () => false},
        'remote.build.depot': {isRemoteBuildDepotEnergyStructure: () => false},
        'work.position': {moveToWorkTarget: () => {}, holdWorkPosition: () => {}},
        'role.upgrader': {run: () => {}}, 'role.repairer': {run: () => {}}, 'role.builder': {run: () => {}}};
    const module = load(`role.${role}.js`, s, name => deps[name]);
    module.run(creep);
    assert.equal(calls.includes('upgrade'), false);
    assert.ok(calls.includes('harvestDepletedSource'));
    const emptyFlagAfter = creep.memory.empty;
    calls.length = 0; creep.carry.energy = 100;
    module.run(creep);
    assert.ok(calls.includes('upgrade'));
    note(role + '-partial-energy-emergency-not-served', {partialEnergy: 50, capacity: 100,
        refillFlagPreserved: emptyFlagAfter, attemptedAction: 'harvestDepletedSource', fullEnergyControl: 'upgrade'});
}

// Execute full main loop while isolating the early emergency-spawn branch.
for (const withSpawn of [true, false]) {
    const s = base(), r = room(s), calls = {tower: 0, safeMode: 0, emergencySpawn: 0};
    r.controller.ticksToDowngrade = 1;
    r.controller.level = 3;
    r.structures.push({id: 'survivingTower', my: true, structureType: 'tower', pos: {x: 12, y: 10}});
    r.hostiles = [{owner: {username: 'Enemy'}}];
    const spawn = {name: 'A', room: r, memory: {}, createCustomCreep: () => {calls.emergencySpawn++; return 'upgrader-A';}};
    s.Game.spawns = withSpawn ? {A: spawn} : {};
    if (!withSpawn) {
        r.spawns = [];
        r.structures = r.structures.filter(o => o.structureType !== 'spawn');
    }
    s.__calls = calls;
    const noop = () => {};
    const req = name => name === 'prototype.spawn' ? noop : name === 'movement' ? {install: noop}
        : ['traffic.stats', 'traffic.flow'].includes(name) ? {beginTick: noop, endTick: noop}
        : {run: noop};
    const extra = `\nensureSpawnMemoryDefaults = function(){};
        getAllSpawnNamesSorted = function(){return Object.keys(Game.spawns)};
        syncSameRoomSpawnMemory = function(){}; cleanupObsoleteSpawnMemory = function(){};
        getRoomMyCreeps = function(){return []}; countRoomRoleWithPlanned = function(){return 0};
        recordSpawnAttempt = function(spawn, result){return result};
        makeCreepName = function(){return 'upgrader-A'};
        runTowerDefense = function(){__calls.tower++};
        triggerAutoSafeMode = function(){__calls.safeMode++};`;
    load('main.js', s, req, extra).loop();
    assert.equal(calls.tower, 0); assert.equal(calls.safeMode, 0);
    assert.equal(calls.emergencySpawn, withSpawn ? 1 : 0);
    note(withSpawn ? 'main-emergency-spawn-skips-defense' : 'main-no-spawn-skips-defense', calls);
}
// Positive safety controls and bootstrap target transitions.
{
    const controls = [];
    for (const kind of ['observe', 'dryRun', 'disabled', 'hostiles', 'cpu', 'roomCap', 'rclCap', 'missingAnchor']) {
        const s = base(), r = room(s); readyState(r);
        const options = {mode: 'place'};
        if (kind === 'observe') options.mode = 'observe';
        if (kind === 'dryRun') options.dryRun = true;
        if (kind === 'disabled') options.enabled = false;
        if (kind === 'hostiles') r.hostiles = [{owner: {username: 'Invader'}}];
        if (kind === 'cpu') s.Game.cpu.bucket = 0;
        if (kind === 'roomCap') options.roomSiteCap = 0;
        if (kind === 'rclCap') r.controller.level = 1;
        if (kind === 'missingAnchor') r.spawns = [];
        const outcome = load('base.builder.executor.js', s).execute(r, r.memory.baseBuilder.plan, options);
        assert.equal(r.intents.length, 0);
        controls.push({kind, status: outcome.status});
    }
    const s = base(), r = room(s); readyState(r);
    const executor = load('base.builder.executor.js', s);
    assert.equal(executor.execute(r, r.memory.baseBuilder.plan, {mode: 'place'}).status, 'placed');
    assert.equal(executor.execute(r, r.memory.baseBuilder.plan, {mode: 'place'}).status, 'paused');
    assert.equal(r.intents.length, 1);
    report.executorControls = controls;
    report.sameTickAttemptGuard = 'one intent';
}
{
    const s = base();
    const countModule = load('creep.counts.js', s);
    const req = name => name === 'prototype.spawn' ? () => {}
        : name === 'movement' ? {install: () => {}}
        : name === 'creep.counts' ? countModule
        : name === 'manager.remoteMining' ? {updateDefaultRemoteLorryAutoTarget: () => {}} : {};
    const main = load('main.js', s, req, '\nmodule.exports.testTargets = applyRclCreepCountTargets;');
    const results = [];
    for (let rcl = 1; rcl <= 8; rcl++) {
        for (const [containers, affordable] of [[false, false], [true, false], [true, true]]) {
            const spawn = {memory: {}, room: {controller: {level: rcl}, memory: {}}};
            main.testTargets(spawn, 2, containers, affordable, false, false, false, false, 1);
            const mature = rcl >= 2 && containers && affordable;
            assert.equal(spawn.memory.minHarvesters, mature ? 0 : 2);
            assert.ok(mature ? spawn.memory.minLorries >= 1 : spawn.memory.minLorries === 0);
            assert.ok(spawn.memory.minBuilders >= 1);
            assert.ok(spawn.memory.minUpgraders >= 1);
            assert.equal(spawn.memory.minCLinkers, 0);
            assert.equal(spawn.memory.minExtractors, 0);
            results.push({rcl, containers, affordable, minHarvesters: spawn.memory.minHarvesters,
                minLorries: spawn.memory.minLorries, minBuilders: spawn.memory.minBuilders,
                minUpgraders: spawn.memory.minUpgraders});
        }
    }
    report.bootstrapTargetControls = {scenarioCount: results.length, results};
}
report.probeCount = report.probes.length;
for (const file of files) assert.equal(crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex'), report.sourceSha256[file],
    'Gameplay source changed during review: ' + file);
if (process.argv.includes('--write-report')) {
    fs.writeFileSync(path.join(__dirname, 'review-results.txt'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({probeCount: report.probeCount, executorControls: report.executorControls.length,
        bootstrapTargetScenarios: report.bootstrapTargetControls.scenarioCount,
        sameTickAttemptGuard: report.sameTickAttemptGuard, report: 'tests/fixtures/base-builder/review-results.txt'}));
} else console.log(JSON.stringify(report, null, 2));
