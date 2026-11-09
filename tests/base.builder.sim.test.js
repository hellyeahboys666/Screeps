'use strict';

// Run: node tests/base.builder.sim.test.js
// Adapter-only controls: node tests/base.builder.sim.test.js --self-test
// No npm, network, live Memory, API writes, terrain fabrication or gameplay edits.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {performance} = require('perf_hooks');
const {
    ROOT, C, Simulation, clone, key, range, digest, countBy, sourceSnapshot, sourceHashes,
    effectiveCap, validateFixture, siteLegal, buildLegal, accessReport
} = require('./helpers/base.builder.sim');

const FIXTURES = path.join(__dirname, 'fixtures/base-builder');
const ROOMS = ['E9S18', 'E9S19', 'E7S18'];
const MAX_TICKS_PER_RCL = 1000;
const SPATIAL_MAXIMA = new Set(['road', 'rampart', 'constructedWall']);
const LEGACY_OBSERVE = {
    E9S18: {counts: {rampart: 17, link: 2, extension: 10, factory: 1, observer: 1, nuker: 1},
        warnings: ['noFeasibleLabCluster']},
    E9S19: {counts: {rampart: 21, container: 1, link: 2, lab: 4, factory: 1}, warnings: []},
    E7S18: {counts: {rampart: 7, container: 1, extension: 10, road: 7, tower: 3,
        spawn: 1, lab: 7, factory: 1, powerSpawn: 1, observer: 1, nuker: 1}, warnings: []}
};

function counter() {
    return {assertions: 0, failures: [], check(ok, invariant, detail) {
        this.assertions++;
        if (!ok) this.failures.push({invariant, detail});
        return !!ok;
    }};
}
function delta(before, after) {
    return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
        .map(type => [type, (after[type] || 0) - (before[type] || 0)]).filter(([, n]) => n));
}
function syntheticControl() {
    // Deliberately NOT a real-room fixture; never written into simulation-results.
    return {room: 'E0S0', shard: 'shard3', variant: 'adapter-self-test', terrain: '0'.repeat(2500), objects: [
        {_id: 'controller', type: 'controller', x: 40, y: 40, user: 'self-test-owner', level: 8},
        {_id: 'spawn', type: 'spawn', x: 25, y: 25, user: 'self-test-owner', name: 'SelfTest'},
        {_id: 'source', type: 'source', x: 10, y: 10},
        {_id: 'mineral', type: 'mineral', x: 15, y: 40}
    ]};
}
function selfTests(sources) {
    let scenarios = 0;
    const failures = [];
    const test = (name, fn) => {
        scenarios++;
        try { fn(); console.log('ok adapter: ' + name); }
        catch (error) {
            failures.push({invariant: 'adapterControl', detail: {name, error: String(error.stack || error)}});
            console.error('FAIL adapter: ' + name + ': ' + error.message);
        }
    };
    test('official RCL tables and independent per-key policy caps', () => {
        assert.strictEqual(C.FIND_STRUCTURES, 107);
        assert.strictEqual(C.FIND_MY_SPAWNS, 112);
        assert.strictEqual(C.MAX_CONSTRUCTION_SITES, 100);
        assert.deepStrictEqual(Object.values(C.CONTROLLER_STRUCTURES.extension), [0, 0, 5, 10, 20, 30, 40, 50, 60]);
        assert.strictEqual(C.CONTROLLER_STRUCTURES.container[1], 5);
        assert.strictEqual(C.CONTROLLER_STRUCTURES.link[8], 6);
        assert.strictEqual(effectiveCap('factory', 8), 0);
        assert.strictEqual(effectiveCap('lab', 8), 3);
        assert.strictEqual(effectiveCap('lab', 8, {factory: 0, lab: 2, tower: 4}, {lab: 1}), 1);
        assert.strictEqual(effectiveCap('tower', 8, {tower: 4}, {lab: 1}), 4);
        assert.strictEqual(effectiveCap('lab', 5, {lab: 10}), 0);
        assert.strictEqual(effectiveCap('lab', 6, {lab: 10}), 3);
        for (const value of [-1, 1.5, '3', null, true, false, {}, [], NaN, Infinity, undefined]) {
            assert.strictEqual(effectiveCap('lab', 8, {lab: value}), 0);
            assert.strictEqual(effectiveCap('tower', 8, {tower: 4}, {tower: value}), 0);
        }
        assert.strictEqual(effectiveCap('factory', 8, {factory: 0}, {factory: 1}), 1);
        assert.strictEqual(effectiveCap('lab', 8, {lab: 99}, {}), 10);
        assert.strictEqual(effectiveCap('tower', 8, {lab: 0}, {}), 6);
    });
    test('construction intents are invisible until settlement, then completed after a later tick', () => {
        const sim = new Simulation(syntheticControl(), {sources});
        assert.strictEqual(sim.room.createConstructionSite(20, 20, 'extension'), C.OK);
        assert.strictEqual(sim.game.constructionSites['simulation-site-1'], undefined);
        assert.strictEqual(sim.built.filter(o => o.type === 'extension').length, 0);
        sim.finishTick();
        assert.strictEqual(sim.sites.length, 1);
        assert.strictEqual(sim.room.find(C.FIND_CONSTRUCTION_SITES).length, 1);
        assert.strictEqual(sim.built.filter(o => o.type === 'extension').length, 0);
        sim.finishTick();
        assert.strictEqual(sim.sites.length, 0);
        assert.strictEqual(sim.built.filter(o => o.type === 'extension').length, 1);
    });
    test('walls, mineral extractor, duplicate sites, hard collisions and legal overlays', () => {
        const fixture = syntheticControl();
        const terrain = fixture.terrain.split(''); terrain[20 * 50 + 20] = '1';
        fixture.terrain = terrain.join('');
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'extension', 20, 20), false);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'road', 20, 20), true);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'rampart', 25, 25), true);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'extension', 25, 25), false);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'extractor', 15, 40), true);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'extractor', 15, 39), false);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'tower', 1, 20), false);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'road', 1, 20), true);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'road', 0, 20), false);
        assert.strictEqual(siteLegal(fixture.objects, fixture.terrain, 'not-a-structure', 20, 20), false);
        const site = {type: 'constructionSite', structureType: 'extension', x: 10, y: 10};
        assert.strictEqual(buildLegal(fixture.objects.concat(site), fixture.terrain, site), false,
            'a source cannot be overwritten by completing a hard structure');
        assert.strictEqual(siteLegal(fixture.objects.concat(site), fixture.terrain, 'rampart', 10, 10), false);
        const road = {_id: 'road', type: 'road', x: 20, y: 21};
        assert.strictEqual(siteLegal(fixture.objects.concat(road), fixture.terrain, 'container', 20, 21), true);
    });
    test('RCL, room ownership, spawn-name and global construction budgets are enforced', () => {
        const sim = new Simulation(syntheticControl(), {sources});
        sim.level = 1;
        assert.strictEqual(sim.room.createConstructionSite(20, 20, 'extension'), C.ERR_RCL_NOT_ENOUGH);
        assert.strictEqual(sim.room.createConstructionSite(20, 20, 'spawn', 'SelfTest'), C.ERR_INVALID_ARGS);
        assert.strictEqual(sim.room.createConstructionSite(0, 20, 'road'), C.ERR_INVALID_TARGET);
        assert.strictEqual(sim.room.createConstructionSite(-1, 20, 'road'), C.ERR_INVALID_ARGS);
        sim.room.controller.my = false;
        assert.strictEqual(sim.room.createConstructionSite(20, 20, 'road'), C.ERR_NOT_OWNER);
        sim.refresh();
        for (let i = 0; i < 100; i++) sim.game.constructionSites['other-room-' + i] = {};
        assert.strictEqual(sim.room.createConstructionSite(20, 20, 'road'), C.ERR_FULL);
    });
    test('neutral roads/containers, controller find semantics and JSON/reset lifetimes', () => {
        const fixture = syntheticControl();
        fixture.objects.push({_id: 'neutral-container', type: 'container', x: 11, y: 10});
        const sim = new Simulation(fixture, {sources});
        assert(sim.room.find(C.FIND_STRUCTURES).some(o => o.structureType === 'controller'));
        assert.strictEqual(sim.room.find(C.FIND_STRUCTURES).find(o => o.id === 'neutral-container').my, undefined);
        assert(!sim.room.find(C.FIND_MY_STRUCTURES).some(o => o.id === 'neutral-container'));
        sim.state.marker = {durable: true};
        const oldState = sim.state;
        sim.reload();
        assert.notStrictEqual(sim.state, oldState);
        assert.strictEqual(sim.state.marker.durable, true);
    });
    test('real runtime loads real manager/survey/compose, observe remains write-free', () => {
        const sim = new Simulation(syntheticControl(), {sources});
        const response = sim.run();
        assert.strictEqual(response[0].status, 'observing', JSON.stringify(sim.state));
        assert.strictEqual(sim.attempts.length, 0);
        assert.strictEqual(sim.instrumentation.calls['manager.baseBuilder.run'], 1);
        assert.strictEqual(sim.instrumentation.calls['base.builder.survey.survey'], 1);
        assert.strictEqual(sim.instrumentation.calls['base.builder.compose.compose'], 1);
        assert(sim.instrumentation.compose[0].elapsedMs > 0);
        sim.finishTick(); sim.state.mode = 'place'; sim.run();
        assert.strictEqual(sim.instrumentation.calls['base.builder.executor.execute'], 1);
        assert(!sim.state.runtimeError, sim.state.runtimeError);
    });
    test('independent access audit catches missing roads and complete rampart coverage', () => {
        const fixture = syntheticControl();
        let report = accessReport(fixture, fixture.objects, 'spawn');
        assert(report.access.every(item => item.reachable));
        assert(report.connections.every(item => !item.connected));
        assert.strictEqual(report.coverage[0].covered, false);
        fixture.objects.push({_id: 'cover', type: 'rampart', x: 25, y: 25, user: 'self-test-owner'});
        report = accessReport(fixture, fixture.objects, 'spawn');
        assert.strictEqual(report.coverage[0].covered, true);
    });
    test('independent road audit rejects a disconnected road despite ordinary access', () => {
        const fixture = syntheticControl();
        for (let n = 11; n < 40; n++) if (n !== 25) {
            fixture.objects.push({_id: 'road-' + n, type: 'road', x: n, y: n});
        }
        let report = accessReport(fixture, fixture.objects, 'spawn');
        assert(report.connections.every(item => item.connected));
        fixture.objects = fixture.objects.filter(o => !['road-20', 'road-21'].includes(o._id));
        report = accessReport(fixture, fixture.objects, 'spawn');
        assert(report.access.every(item => item.reachable));
        assert.strictEqual(report.connections.find(o => o.id === 'source').connected, false);
        assert(report.disconnectedRoads.some(o => o.id === 'road-11'));
    });
    test('shared link seat audit distinguishes private hostile and friendly ramparts', () => {
        const fixture = syntheticControl();
        fixture.objects.push({_id: 'link', type: 'link', x: 12, y: 12, user: 'self-test-owner'});
        const entries = [{type: 'link', purpose: 'sourceLink:source', pos: {x: 12, y: 12}}];
        const check = () => accessReport(fixture, fixture.objects, 'spawn', entries);
        assert.strictEqual(check().linkSeats[0].reachable, true);
        fixture.objects.push({_id: 'seat-cover', type: 'rampart', x: 11, y: 11, user: 'enemy'});
        assert.strictEqual(check().linkSeats[0].reachable, false);
        fixture.objects.at(-1).isPublic = true;
        assert.strictEqual(check().linkSeats[0].reachable, true);
        fixture.objects.at(-1).isPublic = false;
        fixture.objects.at(-1).user = 'self-test-owner';
        assert.strictEqual(check().linkSeats[0].reachable, true);
    });
    test('independent access audit catches sealed extension worker seats', () => {
        const fixture = syntheticControl();
        fixture.objects.push({_id: 'extension', type: 'extension', x: 20, y: 20, user: 'self-test-owner'});
        const terrain = fixture.terrain.split('');
        for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) {
            if (x !== 20 || y !== 20) terrain[y * 50 + x] = '1';
        }
        fixture.terrain = terrain.join('');
        assert.strictEqual(accessReport(fixture, fixture.objects, 'spawn').access
            .find(o => o.id === 'extension').reachable, false);
    });
    test('containers alone are not roads and warnings never waive finite deficits', () => {
        const fixture = syntheticControl();
        fixture.objects.push({_id: 'container', type: 'container', x: 24, y: 25});
        const report = accessReport(fixture, fixture.objects, 'spawn');
        assert.strictEqual(report.connections.find(o => o.id === 'spawn').connected, false);
        const sim = new Simulation(fixture, {sources});
        sim.state.plan = {entries: [], warnings: ['noFeasibleLabCluster']};
        const deficits = finiteDeficits(sim);
        assert.strictEqual(deficits.find(o => o.type === 'lab').missing, 3);
        assert(!deficits.some(o => SPATIAL_MAXIMA.has(o.type)));
        assert.strictEqual(finiteTargets(sim).find(o => o.type === 'factory').officialGap, 1);
        assert.strictEqual(finiteTargets(sim).find(o => o.type === 'factory').policyReduction, 1);
    });
    return {scenarios, status: failures.length ? 'failed' : 'passed', synthetic: true, failures};
}

function materializePlan(sim, plan) {
    return sim.objects.map(o => o.type === 'constructionSite'
        ? Object.assign({}, o, {type: o.structureType}) : clone(o)).concat(plan.entries.map((entry, i) =>
        ({_id: 'proposed-' + i, type: entry.type, x: entry.pos.x, y: entry.pos.y,
            user: ['road', 'container', 'constructedWall'].includes(entry.type) ? undefined : sim.owner})));
}
function auditLayout(sim, objects, records, label, newIds) {
    const targets = objects.filter(o => newIds.has(o._id));
    for (const object of targets) {
        const others = objects.filter(o => o !== object);
        records.check(object.type === 'extractor' || !(Number(sim.fixture.terrain[key(object)]) & C.TERRAIN_MASK_WALL),
            'noNewStructuresOnWallTerrain', {label, object});
        records.check(siteLegal(others, sim.fixture.terrain, object.type, object.x, object.y),
            'legalPositionAndOverlay', {label, object});
        records.check(buildLegal(others, sim.fixture.terrain,
            Object.assign({}, object, {type: 'constructionSite', structureType: object.type})),
        'buildablePosition', {label, object});
        const natural = others.find(o => ['source', 'controller', 'mineral'].includes(o.type) && key(o) === key(object));
        records.check(!natural || (natural.type === 'mineral' && object.type === 'extractor'),
            'naturalObjectPreserved', {label, object, natural});
    }
    const report = accessReport(sim.fixture, objects, sim.state.plan.anchorId, sim.state.plan.entries);
    const unreachable = report.access.filter(item => !item.reachable);
    records.check(unreachable.length === 0, 'reachableSourceControllerAndWorkerSeats', {label, unreachable});
    const missingSeats = report.linkSeats.filter(item => !item.reachable);
    records.check(missingSeats.length === 0, 'reachableSharedLinkWorkerSeats', {label, missingSeats});
    return report;
}
function capAudit(sim, baseline, records, label) {
    for (const type of Object.keys(C.CONTROLLER_STRUCTURES)) {
        records.check((sim.counts[type] || 0) <= Math.max(baseline[type] || 0, sim.cap(type)),
            'noAboveCapAdditions', {label, type, count: sim.counts[type] || 0,
                cap: sim.cap(type), retainedInitial: baseline[type] || 0});
    }
}
function finiteTargets(sim, counts = sim.counts, level = sim.level, officialOnly = false) {
    return Object.keys(C.CONTROLLER_STRUCTURES).filter(type => !SPATIAL_MAXIMA.has(type))
        .map(type => {
            const count = counts[type] || 0, officialCap = C.CONTROLLER_STRUCTURES[type][level] || 0;
            const target = officialOnly ? officialCap : sim.cap(type, level);
            return {type, count, target, officialCap, missing: Math.max(0, target - count),
                officialGap: Math.max(0, officialCap - count), policyReduction: officialCap - target,
                aboveTarget: Math.max(0, count - target)};
        });
}
function finiteDeficits(sim, targets = finiteTargets(sim)) {
    const warnings = sim.state.plan ? sim.state.plan.warnings || [] : sim.state.lastBlockers || [];
    return targets.filter(item => item.missing > 0)
        .map(item => Object.assign({}, item, {
            plannerDeficits: clone(sim.state.plan && sim.state.plan.deficits || []), warnings: clone(warnings)}));
}
function preserveInitial(sim, fixture, records, label) {
    for (const original of fixture.objects) {
        if (original.type === 'constructionSite') {
            const completion = sim.completions.find(c => c._id === original._id);
            records.check(sim.objects.some(o => o._id === original._id) || !!completion,
                'originalSiteRetainedOrCompleted', {label, original});
            continue;
        }
        const current = sim.objects.find(o => o._id === original._id);
        const expected = clone(original);
        if (original.type === 'controller') expected.level = sim.level;
        records.check(JSON.stringify(current) === JSON.stringify(expected), 'originalObjectNotOverwritten',
            {label, id: original._id, expected, current});
    }
    records.check(sim.destroyCalls.length === 0, 'noDestroyOrRemoveCalls', {label, calls: sim.destroyCalls});
}
function runStage(sim, fixture, baseline, records, label) {
    const started = sim.tick, additionIndex = sim.additions.length, statuses = {};
    let terminal, stable = 0;
    for (let t = 0; t < MAX_TICKS_PER_RCL; t++) {
        const attemptIndex = sim.attempts.length, beforeBuilt = JSON.stringify(sim.built);
        const flagCount = Object.keys(sim.flags).length;
        const responses = sim.run();
        const response = responses.find(item => item.room === fixture.room);
        records.check(!!response, 'runtimeVisitedEnrolledRoom', {label, tick: sim.tick, responses});
        if (!response) break;
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        records.check(JSON.stringify(sim.built) === beforeBuilt, 'noCompletionDuringRuntime', {label, tick: sim.tick});
        records.check(sim.attempts.length - attemptIndex <= 1, 'atMostOneSiteAttemptPerRoomTick', {label, tick: sim.tick});
        for (const attempt of sim.attempts.slice(attemptIndex)) {
            records.check(attempt.code === C.OK, 'noInvalidConstructionAttempt', {label, attempt});
            records.check((sim.counts[attempt.type] || 0) < sim.cap(attempt.type),
                'executorHonorsPolicyBeforeSiteCall', {label, attempt, count: sim.counts[attempt.type] || 0,
                    cap: sim.cap(attempt.type)});
        }
        const afterFirstCall = sim.attempts.length;
        sim.run();
        records.check(sim.attempts.length === afterFirstCall, 'sameTickRuntimeCallDoesNotRepeatSiteAttempt',
            {label, tick: sim.tick});
        const quiet = !sim.sites.length && !sim.pending.length && Object.keys(sim.flags).length === flagCount;
        stable = ['complete', 'deferred'].includes(response.status) && quiet ? stable + 1 : 0;
        sim.finishTick();
        capAudit(sim, baseline, records, label + ':tick' + t);
        if (['error', 'blocked', 'anchorChanged', 'versionMismatch', 'needsObserveReplan'].includes(response.status)) {
            records.check(false, 'runtimeProgress', {label, response, runtimeError: sim.state.runtimeError,
                blockers: sim.state.lastBlockers, executor: sim.instrumentation.executions.at(-1)});
            terminal = response.status; break;
        }
        if (stable >= 2) { terminal = response.status; break; }
    }
    records.check(['complete', 'deferred'].includes(terminal), 'boundedRclSettlement',
        {label, ticks: sim.tick - started, maxTicks: MAX_TICKS_PER_RCL, terminal, statuses});
    preserveInitial(sim, fixture, records, label);
    const additions = sim.additions.slice(additionIndex);
    const addedIds = new Set(sim.completions.filter(c => sim.additions.some(a => a.id === c._id)).map(c => c.builtId));
    const layout = auditLayout(sim, sim.objects, records, label, addedIds);
    const disconnected = layout.connections.filter(item => !item.connected);
    records.check(disconnected.length === 0, 'roadsConnectSpawnsSourcesControllerStorage', {label, disconnected});
    const uncovered = sim.level >= 2 ? layout.coverage.filter(item => !item.covered) : [];
    records.check(uncovered.length === 0, 'rampartsCoverBuiltVitals', {label, uncovered});
    const orphanNewRoads = layout.disconnectedRoads.filter(item => addedIds.has(item.id));
    records.check(orphanNewRoads.length === 0, 'newRoadsJoinSpawnNetwork', {label, orphanNewRoads});
    const targets = finiteTargets(sim), deficits = finiteDeficits(sim, targets);
    // A warning is diagnostic, NEVER an implicit waiver of a finite fill target.
    records.check(deficits.length === 0, 'finiteRclTargetsFilled', {label, deficits});
    const remaining = sim.state.plan.entries.filter(e => !sim.objects.some(o =>
        (o.structureType || o.type) === e.type && o.x === e.pos.x && o.y === e.pos.y)
        && (sim.counts[e.type] || 0) < sim.cap(e.type)
        && (!e.requiresType || sim.built.some(o => o.type === e.requiresType
            && o.x === e.pos.x && o.y === e.pos.y)));
    records.check(remaining.length === 0, 'noUnexplainedEligiblePlanEntries', {label, remaining});
    return {label, rcl: sim.level, ticks: sim.tick - started, terminal, statuses, counts: sim.counts,
        additions: countBy(additions), exactAdditions: additions, finiteTargets: targets,
        deficits, access: layout, remainingEligibleEntries: remaining};
}
function runFixture(fixture, filename, sources, fixtureHash = digest(fs.readFileSync(filename))) {
    const records = counter(), started = performance.now();
    const sim = new Simulation(fixture, {sources});
    const baseline = sim.counts;
    const initial = sim.run();
    records.check(initial.length === 1 && initial[0].status === 'observing', 'initialObserveComposes',
        {initial, runtimeError: sim.state.runtimeError, blockers: sim.state.lastBlockers});
    records.check(sim.attempts.length === 0 && sim.pending.length === 0 && Object.keys(sim.flags).length === 0,
        'observeDoesNotPlaceSitesOrFlags', {});
    records.check(sim.instrumentation.compose.length === 1, 'realComposeCalled', sim.instrumentation.calls);
    const firstPlan = clone(sim.state.plan || {entries: [], warnings: [], blockers: sim.state.lastBlockers || []});
    const initialCounts = countBy(firstPlan.entries);
    const liveCounts = fixture.livePlan ? countBy(fixture.livePlan.entries) : null;
    const expected = fixture.variant === 'existing' ? LEGACY_OBSERVE[fixture.room] : null;
    if (expected) records.check(JSON.stringify(delta(expected.counts, liveCounts || {})) === '{}',
        'capturedLivePlanMatchesCoordinatorCounts', {expected: expected.counts, captured: liveCounts});
    // Historical counts are comparisons, not goldens for repaired layout code.
    // Executor policy must NOT change these raw proposals.
    const comparison = {currentCounts: initialCounts, currentWarnings: firstPlan.warnings,
        expectedLegacyCounts: expected && expected.counts, expectedLegacyWarnings: expected && expected.warnings,
        currentMinusLegacy: expected && delta(expected.counts, initialCounts),
        livePlanCounts: liveCounts, livePlanWarnings: fixture.livePlan && fixture.livePlan.warnings,
        liveMinusExpectedLegacy: expected && liveCounts && delta(expected.counts, liveCounts),
        currentMinusLive: liveCounts && delta(liveCounts, initialCounts)};
    const result = {room: fixture.room, variant: fixture.variant, file: path.relative(ROOT, filename),
        capturedAt: fixture.capturedAt, fixtureSha256: fixtureHash,
        startingRcl: sim.level, initialCounts: baseline, initialPlan: firstPlan,
        initialPlanComparison: comparison, stages: []};
    if (sim.state.plan) {
        const full = materializePlan(sim, firstPlan);
        result.initialProposedAccess = auditLayout(sim, full, records, 'initial full proposal',
            new Set(full.filter(o => o._id.startsWith('proposed-')).map(o => o._id)));
        for (const [field, invariant] of [['connections', 'fullProposalRoadConnectivity'],
            ['coverage', 'fullProposalVitalRampartCoverage']]) {
            const failed = result.initialProposedAccess[field].filter(item => !(item.connected || item.covered));
            records.check(failed.length === 0, invariant, {failed});
        }
        const orphanRoads = result.initialProposedAccess.disconnectedRoads.filter(o => o.id.startsWith('proposed-'));
        records.check(orphanRoads.length === 0, 'fullProposalNewRoadsJoinSpawnNetwork', {orphanRoads});
        result.initialProposalOfficialDeficits = finiteDeficits(sim, finiteTargets(sim, countBy(full), 8, true));
        // Fresh proposals must fill every finite official cap. Existing layouts
        // are immutable: enforce executor targets and separately report gaps
        // above policy (e.g. incompatible E9S18 reaction labs, default cap 3).
        result.initialProposalTargets = finiteTargets(sim, countBy(full), 8, fixture.variant === 'fresh');
        result.initialProposalDeficits = finiteDeficits(sim, result.initialProposalTargets);
        records.check(result.initialProposalDeficits.length === 0, 'finiteProposalTargetsFilled',
            {deficits: result.initialProposalDeficits});
        for (const type of Object.keys(C.CONTROLLER_STRUCTURES)) {
            const official = C.CONTROLLER_STRUCTURES[type][8] || 0;
            records.check((initialCounts[type] || 0) <= Math.max(0, official - (baseline[type] || 0)),
                'planContainsNoAboveOfficialCapAdditions', {type, proposed: initialCounts[type] || 0,
                    starting: baseline[type] || 0, officialCap: official});
        }
        result.policyAgnosticComparisons = [];
        for (const config of [{name: 'disabled-finite-types', globalLimits: Object.fromEntries(
            Object.keys(C.CONTROLLER_STRUCTURES).filter(t => !SPATIAL_MAXIMA.has(t)).map(t => [t, 0]))},
        {name: 'explicit-full-official-caps', globalLimits: {factory: 1, lab: 10}, roomLimits: {tower: 1}}]) {
            const other = new Simulation(fixture, {sources, ...config});
            const response = other.run();
            const equal = JSON.stringify(other.state.plan) === JSON.stringify(firstPlan);
            records.check(equal && response[0] && response[0].status === 'observing',
                'realPlannerIsExecutorPolicyAgnostic', {config: config.name, response,
                    comparisonCounts: countBy(other.state.plan && other.state.plan.entries || []),
                    error: other.state.runtimeError});
            records.check(other.attempts.length === 0 && Object.keys(other.flags).length === 0,
                'policyObserveIsWriteFree', {config: config.name});
            result.policyAgnosticComparisons.push({config: config.name, equal, calls: other.instrumentation.calls});
        }
        sim.finishTick(); sim.state.mode = 'place';
        const levels = Array.from({length: 9 - sim.level}, (_, i) => sim.level + i);
        let stageError = false;
        for (const [i, level] of levels.entries()) {
            sim.level = level;
            sim.reload(); // Plans must survive serialized Memory and a module/global reset.
            const label = (fixture.variant === 'existing' && i === 0 ? 'actual' : 'progression') + '-RCL' + level;
            const startedTick = sim.tick;
            try { result.stages.push(runStage(sim, fixture, baseline, records, label)); }
            catch (error) {
                stageError = true;
                records.check(false, 'rclSimulationException', {label, error: String(error.stack || error)});
                result.stages.push({label, rcl: level, ticks: sim.tick - startedTick, terminal: 'error',
                    counts: sim.counts, finiteTargets: finiteTargets(sim), deficits: finiteDeficits(sim),
                    pending: clone(sim.pending), sites: clone(sim.sites)});
                break; // Remaining levels are explicitly failed by missingRclStageEvidence.
            }
        }
        records.check(sim.sites.length === 0 && sim.pending.length === 0, 'allSitesSettledAtEnd',
            {sites: sim.sites, pending: sim.pending});
        if (!stageError) {
            const before = JSON.stringify(sim.additions), counts = clone(sim.counts);
            sim.reload();
            for (let tick = 0; tick < 3; tick++) { sim.run(); sim.finishTick(); }
            records.check(JSON.stringify(sim.additions) === before && JSON.stringify(sim.counts) === JSON.stringify(counts),
                'finalResetIdempotence', {before: counts, after: sim.counts});
        } else records.check(false, 'finalResetIdempotenceNotExercised', {reason: 'rclSimulationException'});
    }
    for (const method of ['base.builder.runtime.run', 'manager.baseBuilder.run', 'base.builder.survey.survey',
        'base.builder.compose.compose', 'base.builder.executor.execute']) {
        records.check(sim.instrumentation.calls[method] > 0, 'realProductionMethodExercised', {method,
            calls: sim.instrumentation.calls[method] || 0});
    }
    Object.assign(result, {elapsedMs: performance.now() - started, calls: sim.instrumentation.calls,
        composeTimings: sim.instrumentation.compose.map(({tick, rcl, elapsedMs, counts}) => ({tick, rcl, elapsedMs, counts})),
        finalCounts: sim.counts, finalFiniteTargets: finiteTargets(sim), finalDeficits: finiteDeficits(sim),
        exactAdditions: sim.additions, completions: sim.completions, additions: countBy(sim.additions),
        attempts: sim.attempts, assertions: records.assertions, failures: records.failures,
        status: records.failures.length ? 'failed' : 'passed'});
    return result;
}

// These are isolated executor controls on captured terrain, NOT fresh-room
// planner evidence. Only the proposal/optional seed occupants are handcrafted;
// runtime -> manager -> executor and subsequent tick settlement are all real.
function policyControlPlan(fixture) {
    const objects = clone(fixture.objects), anchor = objects.find(o => o.type === 'spawn');
    const owner = objects.find(o => o.type === 'controller').user;
    const entries = [], types = ['factory', ...Array(10).fill('lab'), ...Array(6).fill('tower'),
        ...Array(2).fill('extension')];
    const candidates = [];
    for (let y = 2; y <= 47; y++) for (let x = 2; x <= 47; x++) candidates.push({x, y});
    candidates.sort((a, b) => range(a, anchor) - range(b, anchor) || key(a) - key(b));
    for (const type of types) {
        const id = 'control-' + entries.length;
        const pos = candidates.find(p => {
            if (objects.some(o => range(o, p) < 3)
                || !siteLegal(objects, fixture.terrain, type, p.x, p.y)) return false;
            const candidate = {_id: id, type, ...p, user: owner};
            const report = accessReport(fixture, objects.concat(candidate), anchor._id);
            return report.access.every(o => o.reachable);
        });
        assert(pos, 'captured terrain needs enough independent legal control positions: ' + type);
        entries.push({type, pos: clone(pos), priority: entries.length, purpose: 'typeLimitControl:' + entries.length});
        objects.push({_id: id, type, ...pos, user: owner});
    }
    return {valid: true, version: 2, blockers: [], warnings: [],
        anchorId: anchor._id, anchorPos: {x: anchor.x, y: anchor.y}, entries};
}
function policyTests(fixture, sources) {
    const plan = policyControlPlan(fixture), cases = [];
    const add = (name, globals, room, extra = {}) => cases.push({name,
        phases: [{globals, room}], ...extra});
    add('defaults-with-no-typeLimits-keys', undefined, undefined);
    add('defaults-with-empty-typeLimits-objects', {}, {});
    add('per-key-global-overrides', {factory: 1, lab: 5, tower: 2}, undefined);
    add('partial-room-override-retains-unrelated-global-keys', {factory: 1, lab: 5, tower: 2}, {lab: 1});
    add('room-explicit-zero-wins', {factory: 1, lab: 5, tower: 2}, {factory: 0, lab: 0, tower: 0});
    add('room-can-reenable-global-zero', {factory: 0, lab: 0}, {factory: 1, lab: 4});
    add('unlisted-type-retains-official-cap', {lab: 0, factory: 0}, {});
    for (const rcl of [1, 5, 6, 7, 8]) {
        add('policy-cannot-raise-official-RCL' + rcl + '-caps', {factory: 99, lab: 99, tower: 99}, {}, {rcl});
    }
    add('built-and-owned-sites-both-count-toward-policy', {}, {}, {seedBuiltLabs: 2, seedLabSites: 1});
    add('preexisting-above-policy-is-retained-not-expanded', {}, {}, {seedBuiltLabs: 4});
    const invalid = [['negative', -1], ['fraction', 1.5], ['numeric-string', '3'], ['null', null],
        ['true', true], ['false', false], ['object', {}], ['array', []], ['NaN', NaN],
        ['Infinity', Infinity], ['explicit-undefined', undefined]];
    for (const [description, value] of invalid) {
        add('global-invalid-' + description + '-fails-closed-per-key',
            {lab: value, tower: value, factory: 1}, {});
        add('room-invalid-' + description + '-overrides-valid-global',
            {lab: 5, tower: 2, factory: 1}, {lab: value, tower: value});
    }
    cases.push({name: 'policy-change-and-JSON-module-reset-resume-the-same-plan', resetEachPhase: true,
        phases: [{globals: {lab: 1, factory: 0}},
            {globals: {lab: 5, factory: 1, tower: 2}, room: {lab: 2}},
            {globals: {lab: 5, factory: 1, tower: 2}, room: {lab: 0}},
            {globals: {lab: 5, factory: 1, tower: 2}, room: {lab: 4}}]});
    const results = [];
    for (const scenario of cases) {
        const records = counter(), phases = [];
        const sim = new Simulation(fixture, {sources, mode: 'place'});
        sim.level = scenario.rcl || 8;
        Object.assign(sim.state, {plan: clone(plan), planVersion: 2, generatedTick: sim.tick - 1});
        const labEntries = plan.entries.filter(e => e.type === 'lab');
        let seeded = 0;
        for (let n = 0; n < (scenario.seedBuiltLabs || 0); n++) {
            sim.objects.push({_id: 'seed-lab-' + seeded, type: 'lab', ...labEntries[seeded++].pos, user: sim.owner});
        }
        for (let n = 0; n < (scenario.seedLabSites || 0); n++) {
            sim.objects.push({_id: 'seed-site-' + seeded, type: 'constructionSite', structureType: 'lab',
                ...labEntries[seeded++].pos, user: sim.owner});
        }
        sim.refresh();
        const initial = clone(sim.objects), initialPlan = JSON.stringify(sim.state.plan);
        try {
            for (const [phaseIndex, phase] of scenario.phases.entries()) {
                if (scenario.resetEachPhase) sim.reload();
                // Assign AFTER reset: undefined/NaN/Infinity are explicit hostile
                // in-tick values. JSON itself cannot preserve those values.
                if (phase.globals === undefined) delete sim.memory.baseBuilder.typeLimits;
                else sim.memory.baseBuilder.typeLimits = Object.assign({}, phase.globals);
                if (phase.room === undefined) delete sim.state.typeLimits;
                else sim.state.typeLimits = Object.assign({}, phase.room);
                const before = sim.counts, additionIndex = sim.additions.length, statuses = {};
                let quiet = 0, terminal;
                for (let t = 0; t < 80; t++) {
                    const attemptIndex = sim.attempts.length;
                    const response = sim.run().find(r => r.room === fixture.room);
                    records.check(!!response, 'policyRuntimeVisitedRoom', {phaseIndex, response});
                    if (!response) break;
                    statuses[response.status] = (statuses[response.status] || 0) + 1;
                    records.check(sim.attempts.length - attemptIndex <= 1, 'policyOneAttemptPerTick', {phaseIndex});
                    for (const attempt of sim.attempts.slice(attemptIndex)) {
                        records.check(attempt.code === C.OK, 'policyNoInvalidSiteCall', {phaseIndex, attempt});
                        records.check((sim.counts[attempt.type] || 0) < sim.cap(attempt.type),
                            'policyLimitEnforcedBeforeAPICall', {phaseIndex, attempt,
                                count: sim.counts[attempt.type] || 0, effectiveCap: sim.cap(attempt.type)});
                    }
                    quiet = ['deferred', 'complete'].includes(response.status)
                        && !sim.pending.length && !sim.sites.length ? quiet + 1 : 0;
                    sim.finishTick();
                    if (['error', 'blocked', 'anchorChanged', 'versionMismatch'].includes(response.status)) {
                        records.check(false, 'policyRuntimeProgress', {phaseIndex, response, error: sim.state.runtimeError});
                        terminal = response.status; break;
                    }
                    if (quiet >= 2) { terminal = response.status; break; }
                }
                records.check(['deferred', 'complete'].includes(terminal), 'policyBoundedSettlement', {phaseIndex, terminal, statuses});
                const expected = {};
                for (const [type, proposed] of Object.entries(countBy(plan.entries))) {
                    expected[type] = Math.max(before[type] || 0, Math.min(proposed, sim.cap(type)));
                    records.check((sim.counts[type] || 0) === expected[type], 'policyExactFinalCount',
                        {phaseIndex, type, expected: expected[type], actual: sim.counts[type] || 0,
                            effectiveCap: sim.cap(type), retained: before[type] || 0});
                }
                records.check(JSON.stringify(sim.state.plan) === initialPlan, 'policyDoesNotMutateStoredProposal', {phaseIndex});
                records.check(sim.sites.length === 0 && sim.pending.length === 0, 'policyAllAcceptedSitesCompleted', {phaseIndex});
                phases.push({phaseIndex, rcl: sim.level, terminal, statuses, expected, counts: sim.counts,
                    additions: countBy(sim.additions.slice(additionIndex))});
            }
            for (const object of initial) {
                records.check(sim.objects.some(o => o._id === object._id && JSON.stringify(o) === JSON.stringify(object))
                    || (object.type === 'constructionSite' && sim.completions.some(c => c._id === object._id)),
                'policyPreservesInitialObjectsAndSites', {id: object._id});
            }
            records.check(sim.destroyCalls.length === 0, 'policyNeverDestroysAboveLimitStructures', sim.destroyCalls);
            for (const method of ['base.builder.runtime.run', 'manager.baseBuilder.run', 'base.builder.executor.execute']) {
                records.check(sim.instrumentation.calls[method] > 0, 'policyRealProductionCall', {method});
            }
        } catch (error) {
            records.check(false, 'policyControlException', String(error.stack || error));
        }
        const result = {name: scenario.name, room: fixture.room, rcl: sim.level, phases,
            handcraftedProposal: true, syntheticSeedObjects: seeded,
            assertions: records.assertions, failures: records.failures,
            calls: sim.instrumentation.calls, resets: sim.instrumentation.resets,
            exactAdditions: sim.additions, status: records.failures.length ? 'failed' : 'passed'};
        results.push(result);
        console.log(result.status.toUpperCase() + ' policy ' + result.name + ' failures=' + result.failures.length);
    }
    return {scenarios: results.length, assertions: results.reduce((sum, r) => sum + r.assertions, 0),
        failures: results.flatMap(r => r.failures.map(f => ({scenario: r.name, ...f}))), results};
}

function main() {
    const sources = sourceSnapshot(), hashes = sourceHashes(sources);
    const harnessFiles = [__filename, path.join(__dirname, 'helpers/base.builder.sim.js')];
    const harnessHashes = Object.fromEntries(harnessFiles.map(file => [path.relative(ROOT, file), digest(fs.readFileSync(file))]));
    const adapter = selfTests(sources);
    if (process.argv.includes('--self-test')) {
        console.log((adapter.failures.length ? 'FAIL: ' : 'PASS: ') + adapter.scenarios
            + ' adapter controls; ' + adapter.failures.length + ' failures; real-room simulations NOT run.');
        if (adapter.failures.length) process.exitCode = 1;
        return;
    }
    const files = ROOMS.flatMap(room => [room + '.json', room + '.fresh.json']).map(file => path.join(FIXTURES, file));
    const missing = files.filter(file => !fs.existsSync(file));
    if (missing.length) {
        console.error('BLOCKED: missing real fixtures: ' + missing.map(file => path.basename(file)).join(', '));
        console.error('No simulation-results.json written; adapter controls are not real-room evidence.');
        process.exitCode = 1; return;
    }
    const fixtureHashes = {};
    const fixtures = files.map(file => {
        const bytes = fs.readFileSync(file);
        fixtureHashes[path.relative(ROOT, file)] = digest(bytes);
        const fixture = JSON.parse(bytes); validateFixture(fixture); return fixture;
    });
    for (const room of ROOMS) {
        const existing = fixtures.find(f => f.room === room && f.variant === 'existing');
        const fresh = fixtures.find(f => f.room === room && f.variant === 'fresh');
        assert(existing && fresh, 'each named room needs both variants');
        assert.strictEqual(fresh.terrain, existing.terrain, room + ' fresh terrain must be real and identical');
        const anchor = existing.objects.filter(o => o.type === 'spawn').sort((a, b) => a._id.localeCompare(b._id))[0];
        assert.deepStrictEqual(fresh.objects.find(o => o.type === 'spawn'), anchor, room + ' must retain the lowest-ID spawn');
        assert.deepStrictEqual(fresh.objects.filter(o => ['source', 'mineral'].includes(o.type)),
            existing.objects.filter(o => ['source', 'mineral'].includes(o.type)), room + ' natural objects must be preserved');
    }
    const results = [];
    for (const [i, fixture] of fixtures.entries()) {
        try {
            const result = runFixture(fixture, files[i], sources, fixtureHashes[path.relative(ROOT, files[i])]);
            results.push(result);
            console.log(result.status.toUpperCase() + ' ' + fixture.room + '/' + fixture.variant
                + ' assertions=' + result.assertions + ' failures=' + result.failures.length
                + ' composeMs=' + result.composeTimings.map(t => t.elapsedMs.toFixed(1)).join(','));
            console.log('  initial plan ' + JSON.stringify(result.initialPlanComparison));
            console.log('  additions ' + JSON.stringify(result.additions));
            for (const stage of result.stages) console.log('  ' + stage.label + ' ticks=' + stage.ticks
                + ' terminal=' + stage.terminal + ' deficits=' + JSON.stringify(stage.deficits));
            for (const failure of result.failures.slice(0, 12)) console.error('  FAIL ' + JSON.stringify(failure));
            if (result.failures.length > 12) console.error('  Full failure details and exact additions saved in machine results.');
        } catch (error) {
            results.push({room: fixture.room, variant: fixture.variant, status: 'error', assertions: 0,
                failures: [{invariant: 'uncaughtSimulationError', detail: String(error.stack || error)}]});
            console.error('ERROR ' + fixture.room + '/' + fixture.variant + ': ' + (error.stack || error));
        }
    }
    assert.strictEqual(results.length, 6, 'must produce all six real-room results');
    let policies;
    try { policies = policyTests(fixtures.find(f => f.variant === 'fresh'), sources); }
    catch (error) {
        policies = {scenarios: 0, assertions: 0, results: [], failures: [
            {invariant: 'policySuiteException', detail: String(error.stack || error)}]};
    }
    const sourceStable = JSON.stringify(hashes) === JSON.stringify(sourceHashes(sourceSnapshot()));
    const integrityFailures = [];
    if (!sourceStable) integrityFailures.push({invariant: 'productionSourcesChangedDuringSimulation'});
    for (const [file, hash] of Object.entries({...harnessHashes, ...fixtureHashes})) {
        if (digest(fs.readFileSync(path.join(ROOT, file))) !== hash) {
            integrityFailures.push({invariant: 'simulationInputChangedDuringRun', file});
        }
    }
    for (const [i, fixture] of fixtures.entries()) {
        const actualLevels = (results[i].stages || []).map(stage => stage.rcl);
        const start = fixture.objects.find(o => o.type === 'controller').level;
        const expectedLevels = Array.from({length: 9 - start}, (_, j) => start + j);
        if (JSON.stringify(actualLevels) !== JSON.stringify(expectedLevels)) {
            integrityFailures.push({invariant: 'missingRclStageEvidence', room: fixture.room,
                variant: fixture.variant, expectedLevels, actualLevels});
        }
    }
    const realFailures = results.reduce((sum, r) => sum + r.failures.length, 0);
    const totalFailures = realFailures + policies.failures.length + adapter.failures.length + integrityFailures.length;
    const realAssertions = results.reduce((sum, r) => sum + r.assertions, 0);
    const report = {schemaVersion: 2, generatedAt: new Date().toISOString(), nodeVersion: process.version,
        command: 'node tests/base.builder.sim.test.js', constantsOrigin: 'official screeps/common and screeps/engine',
        bounds: {maxTicksPerRcl: MAX_TICKS_PER_RCL, maxRuntimeCallMs: 30000},
        policy: {defaults: {factory: 0, lab: 3}, precedence: ['defaults', 'global per-key', 'room per-key'],
            invalidExplicitValues: 'fail closed to zero', plannerBounds: 'official RCL8 caps, not executor policy',
            spatialMaximaNotFillTargets: [...SPATIAL_MAXIMA]},
        limitations: ['Not the official server: deterministic construction/terrain/RCL adapter.',
            'No energy, creep work, decay, combat or controller-XP simulation; sites auto-complete after a later tick.',
            'Compose timings are Node wall-clock milliseconds, not MMO CPU measurements.',
            'Baseline proposal-count differences are reported, not frozen across intentional gameplay changes.',
            'Policy controls use handcrafted proposals/seed occupants on captured terrain, separately from real planner scenarios.',
            'Non-JSON policy values are injected after reset to test explicit in-tick fail-closed handling.'],
        sourceSha256: hashes, sourceStable, harnessSha256: harnessHashes, fixtureSha256: fixtureHashes,
        integrityFailures, adapterControls: adapter, policyControls: policies,
        scenarios: results.length, realRoomAssertions: realAssertions, realRoomFailures: realFailures,
        assertions: realAssertions + policies.assertions,
        failures: totalFailures, status: totalFailures ? 'failed' : 'passed', results};
    fs.writeFileSync(path.join(FIXTURES, 'simulation-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(report.status.toUpperCase() + ': ' + report.scenarios + ' real-room scenarios; '
        + realAssertions + ' real-room assertions; ' + realFailures + ' real-room failures; '
        + policies.scenarios + ' policy controls; ' + policies.assertions + ' policy assertions; '
        + policies.failures.length + ' policy failures; ' + totalFailures + ' total failures.');
    console.log('Machine results: tests/fixtures/base-builder/simulation-results.json');
    if (!sourceStable) console.error('FAIL: production sources changed during simulation; rerun against stable bytes.');
    if (totalFailures) process.exitCode = 1;
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = {main, selfTests, runFixture, policyTests, finiteTargets, finiteDeficits};
