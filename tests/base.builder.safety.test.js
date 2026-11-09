'use strict';
// Offline regressions for retained review findings and live-placement gates.
const assert = require('assert');
const {C, Simulation, sourceSnapshot} = require('./helpers/base.builder.sim');
const sources = sourceSnapshot();
let scenarios = 0;
function test(name, fn) { fn(); scenarios++; console.log('ok safety: ' + name); }
function fixture() {
    return {room: 'E0S0', shard: 'shard3', variant: 'safety-control', terrain: '0'.repeat(2500), objects: [
        {_id: 'controller', type: 'controller', x: 40, y: 40, user: 'owner', level: 8},
        {_id: 'anchor', type: 'spawn', x: 25, y: 25, user: 'owner', name: 'Anchor'},
        {_id: 'source', type: 'source', x: 10, y: 10},
        {_id: 'mineral', type: 'mineral', x: 15, y: 40}
    ]};
}
function entry(type = 'extension', x = 20, y = 20, extra = {}) {
    return {type, pos: {x, y}, priority: 10, purpose: 'control', ...extra};
}
function ready(f = fixture(), entries = [entry()]) {
    const sim = new Simulation(f, {sources, mode: 'place'});
    const anchor = f.objects.find(o => o.type === 'spawn');
    Object.assign(sim.state, {planVersion: 2, generatedTick: sim.tick - 1,
        plan: {valid: true, blockers: [], entries, anchorId: anchor._id, anchorPos: {x: anchor.x, y: anchor.y}}});
    return sim;
}
function execute(sim, options = {}) {
    return sim.load('base.builder.executor').execute(sim.room, sim.state.plan, {mode: 'place', ...options});
}
function manage(sim) {
    return sim.load('manager.baseBuilder').run(sim.room, {executor: sim.load('base.builder.executor')});
}
function hostiles(sim, ordinary, power) {
    const find = sim.room.find;
    sim.room.find = (kind, opts) => kind === C.FIND_HOSTILE_CREEPS ? ordinary
        : kind === C.FIND_HOSTILE_POWER_CREEPS ? power : find(kind, opts);
}

test('runtime is inert without opt-in and with global disabled', () => {
    const sim = ready();
    delete sim.memory.baseBuilder;
    delete sim.memory.rooms[sim.fixture.room].baseBuilder;
    const before = JSON.stringify(sim.memory);
    assert.deepStrictEqual(sim.run(), []);
    assert.strictEqual(JSON.stringify(sim.memory), before);
    assert.strictEqual(sim.instrumentation.calls['manager.baseBuilder.run'], undefined);
    sim.memory.baseBuilder = {disabled: true};
    sim.memory.rooms[sim.fixture.room].baseBuilder = {mode: 'place'};
    assert.deepStrictEqual(sim.run(), []);
    assert.strictEqual(sim.attempts.length, 0);
});
test('explicit modes, dry-run and enable gates never place', () => {
    for (const config of [{mode: 'observe'}, {dryRun: true}, {enabled: false}, {roomEnabled: false}]) {
        const sim = ready();
        assert.strictEqual(execute(sim, config).status, 'inactive');
        assert.strictEqual(sim.attempts.length, 0);
    }
});
test('ownership and immutable original spawn identity/position are required', () => {
    for (const change of [s => { s.room.controller.my = false; },
        s => { s.state.plan.anchorId = 'missing'; }, s => { s.state.plan.anchorPos.x++; }]) {
        const sim = ready(); change(sim);
        assert.strictEqual(execute(sim).status, 'blocked');
        assert.strictEqual(sim.attempts.length, 0);
    }
});
test('RCL and global/room construction budgets are checked before API calls', () => {
    for (const kind of ['rcl', 'global', 'room', 'cpu']) {
        const sim = ready();
        let options = {};
        if (kind === 'rcl') sim.level = 1;
        if (kind === 'global') for (let i = 0; i < 100; i++) sim.game.constructionSites['other-' + i] = {};
        if (kind === 'room') options.roomSiteCap = 0;
        if (kind === 'cpu') sim.game.cpu.bucket = 1999;
        assert.strictEqual(execute(sim, options).status, kind === 'rcl' ? 'deferred' : 'paused');
        assert.strictEqual(sim.attempts.length, 0);
    }
});
test('pause switches/timers hold through exact expiry and JSON reset', () => {
    for (const scope of ['global', 'room']) {
        const sim = ready(), config = scope === 'global' ? sim.memory.baseBuilder : sim.state;
        config.paused = true;
        assert.strictEqual(manage(sim).status, 'paused');
        delete config.paused;
        config.pauseUntil = sim.tick + 2;
        assert.strictEqual(manage(sim).status, 'paused');
        sim.tick += 2; sim.reload();
        assert.strictEqual(manage(sim).status, 'paused'); // Inclusive existing pauseUntil semantics.
        sim.tick++; sim.reload();
        assert.strictEqual(manage(sim).status, 'placed');
        assert.strictEqual(sim.attempts.length, 1);
    }
});
test('power-creep and mixed NPC/player sightings persist cooldown after departure', () => {
    const enemy = {owner: {username: 'Enemy'}}, npc = {owner: {username: 'Invader'}};
    for (const [ordinary, power] of [[[], [enemy]], [[npc, enemy], []], [[npc], [enemy]]]) {
        const sim = ready(), sighted = sim.tick;
        hostiles(sim, ordinary, power);
        assert.strictEqual(manage(sim).status, 'paused');
        assert.strictEqual(sim.state.lastPlayerHostileTick, sighted);
        sim.tick++; sim.reload();
        assert.strictEqual(manage(sim).status, 'paused');
        sim.tick = sighted + 1499; sim.reload();
        assert.strictEqual(manage(sim).status, 'paused');
        sim.tick = sighted + 1500; sim.reload();
        assert.strictEqual(manage(sim).status, 'placed');
        assert.strictEqual(sim.attempts.length, 1);
    }
    const sim = ready();
    hostiles(sim, [npc], []);
    assert.strictEqual(manage(sim).status, 'paused');
    assert.strictEqual(sim.state.lastPlayerHostileTick, undefined);
    sim.tick++; sim.reload();
    assert.strictEqual(manage(sim).status, 'placed');
});
test('stale proposal cannot seal a source after manual hard construction or a pending site', () => {
    for (const pending of [false, true]) {
        const f = fixture();
        const open = new Set(['10,10', '10,11', '11,11', '10,12', '10,13', '11,10', '12,10', '13,10']);
        f.terrain = Array.from({length: 2500}, (_, i) => open.has((i % 50) + ',' + Math.floor(i / 50)) ? '0' : '1').join('');
        f.objects = [{_id: 'controller', type: 'controller', x: 13, y: 10, user: 'owner', level: 8},
            {_id: 'anchor', type: 'spawn', x: 10, y: 10, user: 'owner'},
            {_id: 'source', type: 'source', x: 10, y: 13},
            {_id: 'manual', type: pending ? 'constructionSite' : 'constructedWall',
                ...(pending ? {structureType: 'constructedWall'} : {}), x: 11, y: 11, user: 'owner'}];
        const sim = ready(f, [entry('extension', 10, 11)]);
        assert.strictEqual(execute(sim).status, 'deferred');
        assert.strictEqual(sim.attempts.length, 0);
        sim.objects = sim.objects.filter(o => o._id !== 'manual'); sim.refresh();
        assert.strictEqual(execute(sim).status, 'placed'); // Removing only the blocking wall makes the proposal safe.
    }
});
test('vital rampart overlays require a built dependency, not just a future/site entry', () => {
    const sim = ready(fixture(), [entry('rampart', 20, 20, {priority: 1, requiresType: 'factory'}),
        entry('factory', 20, 20)]);
    assert.strictEqual(execute(sim).status, 'deferred'); // Factory disabled by default; no empty rampart.
    assert.strictEqual(sim.attempts.length, 0);
    sim.memory.baseBuilder.typeLimits = {factory: 1};
    assert.strictEqual(execute(sim).entry.type, 'factory');
    sim.finishTick();
    assert.strictEqual(execute(sim).status, 'deferred');
    sim.finishTick();
    assert.strictEqual(execute(sim).entry.type, 'rampart');
    sim.finishTick(); sim.finishTick();
    assert.deepStrictEqual(sim.counts, {factory: 1, rampart: 1, spawn: 1});
});
test('existing owned ramparts permit a hard underlying site; hostile ramparts do not', () => {
    for (const user of ['owner', 'enemy']) {
        const f = fixture(); f.objects.push({_id: 'cover', type: 'rampart', x: 20, y: 20, user});
        const sim = ready(f);
        assert.strictEqual(execute(sim).status, user === 'owner' ? 'placed' : 'deferred');
    }
});
test('open exit fringe, natural objects, other sites and hard occupants are rejected', () => {
    for (const kind of ['exit', 'wall', 'source', 'site', 'structure']) {
        const f = fixture(); let target = entry();
        if (kind === 'exit') target.pos.x = 1;
        if (kind === 'wall') { const terrain = f.terrain.split(''); terrain[20 * 50 + 20] = '1'; f.terrain = terrain.join(''); }
        if (kind === 'source') target.pos = {x: 10, y: 10};
        if (kind === 'site') f.objects.push({_id: 'site', type: 'constructionSite', structureType: 'tower', x: 20, y: 20, user: 'owner'});
        if (kind === 'structure') f.objects.push({_id: 'tower', type: 'tower', x: 20, y: 20, user: 'owner'});
        const sim = ready(f, [target]);
        assert.strictEqual(execute(sim).status, 'deferred');
        assert.strictEqual(sim.attempts.length, 0);
    }
});
test('invalid target quarantines only that entry; transient errors back off and recover', () => {
    for (const kind of ['invalid', 'full', 'rcl', 'throw']) {
        const sim = ready(); let calls = 0;
        sim.room.createConstructionSite = () => { calls++; if (kind === 'throw') throw new Error('test');
            return kind === 'invalid' ? C.ERR_INVALID_TARGET : kind === 'rcl' ? C.ERR_RCL_NOT_ENOUGH : C.ERR_FULL; };
        assert.strictEqual(execute(sim).status, 'error');
        assert.strictEqual(execute(sim).status, 'paused');
        assert.strictEqual(calls, 1);
        sim.tick++; sim.reload();
        assert.strictEqual(execute(sim).status, kind === 'invalid' ? 'deferred' : 'paused');
        sim.tick += 25; sim.reload();
        assert.strictEqual(execute(sim).status, kind === 'invalid' ? 'deferred' : 'placed');
    }
});
test('neutral containers and owned sites count toward type budgets', () => {
    const f = fixture();
    f.objects.push({_id: 'neutral', type: 'container', x: 15, y: 15});
    const sim = ready(f, [entry('container')]);
    sim.memory.baseBuilder.typeLimits = {container: 1};
    assert.strictEqual(execute(sim).status, 'deferred');
    assert.strictEqual(sim.attempts.length, 0);
});
test('source-link flags stay off below RCL5 or when link policy disables them', () => {
    for (const rcl of [1, 4, 8]) {
        const sim = ready(fixture(), [entry('link', 12, 10, {purpose: 'sourceLink:source'})]);
        sim.level = rcl;
        if (rcl === 8) sim.memory.baseBuilder.typeLimits = {link: 0};
        assert.strictEqual(manage(sim).status, 'deferred');
        assert.deepStrictEqual(sim.flags, {});
    }
});
test('old plan versions fail closed until explicit observe replan', () => {
    const sim = ready(); sim.state.planVersion = 1;
    assert.strictEqual(sim.run()[0].status, 'versionMismatch');
    assert.strictEqual(sim.attempts.length, 0);
    sim.state.replanRequested = true;
    assert.strictEqual(sim.run()[0].status, 'needsObserveReplan');
    sim.state.mode = 'observe';
    assert.strictEqual(sim.run()[0].status, 'observing');
    assert.strictEqual(sim.state.planVersion, 2);
    assert.strictEqual(sim.attempts.length, 0);
});
test('existing reaction-lab geometry cannot fit ten without replacement (E9S18)', () => {
    const f = require('./fixtures/base-builder/E9S18.json');
    const labs = f.objects.filter(o => o.type === 'lab'), dist = (a, b) => Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y));
    assert.strictEqual(labs.length, 3);
    // Exhaust every input pair geometrically (ignore terrain/occupants, making
    // this an optimistic upper bound). Locked labs must be inputs or outputs.
    const positions = [];
    for (let y = 1; y <= 48; y++) for (let x = 1; x <= 48; x++) {
        const p = {x, y};
        // A new input must serve at least two of three locked labs: only the
        // other input can be exempt from output range. Include all locked labs.
        if (labs.some(l => dist(l, p) === 0) || labs.filter(l => dist(l, p) <= 2).length >= 2) positions.push(p);
    }
    let maxOutputs = 0;
    for (let i = 0; i < positions.length; i++) for (let j = i+1; j < positions.length; j++) {
        const a = positions[i], b = positions[j];
        const lockedOutputs = labs.filter(l => dist(l, a) !== 0 && dist(l, b) !== 0);
        if (lockedOutputs.some(l => dist(l, a) > 2 || dist(l, b) > 2)) continue;
        let outputs = 0;
        for (let y = 1; y <= 48; y++) for (let x = 1; x <= 48; x++) {
            const p = {x, y}; if (dist(p, a) && dist(p, b) && dist(p, a) <= 2 && dist(p, b) <= 2) outputs++;
        }
        maxOutputs = Math.max(maxOutputs, outputs);
    }
    assert(maxOutputs < 8, 'a ten-lab reaction cluster needs eight output tiles');
});
console.log('PASS: ' + scenarios + ' base-builder safety scenarios; no live API calls.');
