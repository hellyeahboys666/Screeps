// Room-level lifecycle. Deliberately inert until a room mode or new-room policy is set.
var PLAN_VERSION = 2;
function result(state, status, detail) {
    state.status = status;
    state.lastChecked = Game.time;
    return {status: status, detail: detail};
}
function ensureSourceFlag(room, state, executor) {
    if (state.autoSourceFlags === false || typeof room.createFlag !== 'function'
        || typeof FIND_FLAGS === 'undefined' || typeof FIND_SOURCES === 'undefined'
        || typeof COLOR_WHITE === 'undefined') return;
    var sources = room.find(FIND_SOURCES), flags = room.find(FIND_FLAGS);
    var structures = room.find(FIND_STRUCTURES), sites = room.find(FIND_CONSTRUCTION_SITES);
    if (!Array.isArray(sources) || !Array.isArray(flags)
        || !Array.isArray(structures) || !Array.isArray(sites)) return;
    var cap = executor.typeLimit(room, 'link');
    if (!cap) return;
    var linkCount = structures.concat(sites).filter(function(o) {
        return o.my === true && o.structureType === 'link';
    }).length;
    for (var entry of state.plan.entries) {
        if (entry.type !== 'link' || typeof entry.purpose !== 'string'
            || entry.purpose.indexOf('sourceLink:') !== 0) continue;
        if (linkCount >= cap && !structures.some(function(o) {
            return o.my === true && o.structureType === 'link'
                && o.pos.x === entry.pos.x && o.pos.y === entry.pos.y;
        })) continue;
        var sourceId = entry.purpose.slice('sourceLink:'.length);
        var source = sources.filter(function(s) { return s.id === sourceId; })[0];
        if (!source || !source.pos || !Number.isInteger(source.pos.x)
            || !Number.isInteger(source.pos.y)) continue;
        // The active bot associates a white flag with its closest source. An
        // exact-source marker is unambiguous, even in a tight two-source room.
        if (flags.some(function(flag) {
            if (!flag || flag.color !== COLOR_WHITE || !flag.pos) return false;
            var nearest = sources.filter(function(s) { return s && s.pos; }).map(function(s) {
                return {id: s.id, distance: Math.max(Math.abs(s.pos.x - flag.pos.x),
                    Math.abs(s.pos.y - flag.pos.y))};
            }).sort(function(a, b) { return a.distance - b.distance; });
            return nearest.length && nearest[0].id === sourceId
                && (nearest.length === 1 || nearest[0].distance < nearest[1].distance);
        })) continue;
        var name = 'BB-' + room.name + '-' + sourceId;
        if (name.length > 100 || (Game.flags && Game.flags[name])) {
            state.flagIssue = 'nameConflict:' + sourceId;
            continue;
        }
        try {
            var response = room.createFlag(source.pos.x, source.pos.y, name,
                COLOR_WHITE, COLOR_WHITE);
            if (response === name) {
                state.lastFlagTick = Game.time;
                delete state.flagIssue;
            } else state.flagIssue = 'createFlag:' + response;
        } catch (error) { state.flagIssue = 'createFlagException'; }
        return; // one new flag per room/tick, and retry failure only next tick
    }
}
function run(room, deps) {
    if (!room || !room.name || !room.controller || !room.controller.my) {
        return {status: 'ineligible'};
    }
    Memory.baseBuilder = Memory.baseBuilder || {};
    var config = Memory.baseBuilder;
    if (config.disabled === true) return {status: 'off'};
    // First activation snapshots all *currently owned/eligible* rooms as legacy.
    // Future rooms enrolled only when their first eligible tick is strictly later.
    if (config.autoNewRooms === true && !Number.isInteger(config.autoNewRoomsSince)) {
        config.autoNewRoomsSince = Game.time;
    }
    var spawns = room.find(typeof FIND_MY_SPAWNS !== 'undefined' ? FIND_MY_SPAWNS : 'mySpawns');
    if (!Array.isArray(spawns) || !spawns.some(function(s) {
        return s && s.my && s.structureType === 'spawn';
    })) return {status: 'ineligible'};
    var state = room.memory.baseBuilder || (room.memory.baseBuilder = {});
    // Existing main-loop threat telemetry is the authoritative recent player
    // sighting; preserve it across ticks so the executor's cooldown is effective.
    var seen = room.memory.hostilePlayerLastSeen;
    if (Number.isInteger(seen) && seen <= Game.time
        && (!Number.isInteger(state.lastPlayerHostileTick) || seen > state.lastPlayerHostileTick)) {
        state.lastPlayerHostileTick = seen;
    }
    if (!Number.isInteger(state.firstEligibleTick)) state.firstEligibleTick = Game.time;
    if (!state.mode && config.autoNewRooms === true
        && state.firstEligibleTick > config.autoNewRoomsSince) state.mode = 'place';
    if (state.mode !== 'place' && state.mode !== 'observe') return result(state, 'off');
    // A successful emergency spawn can skip main's later hostile telemetry.
    // Record player sightings here too, so a just-departed attacker cannot
    // leave a one-tick gap that permits construction before the cooldown.
    if (typeof FIND_HOSTILE_CREEPS !== 'undefined') {
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        var powerHostiles = typeof FIND_HOSTILE_POWER_CREEPS === 'undefined'
            ? [] : room.find(FIND_HOSTILE_POWER_CREEPS);
        if (Array.isArray(hostiles) && Array.isArray(powerHostiles)) hostiles = hostiles.concat(powerHostiles);
        if (Array.isArray(hostiles) && hostiles.some(function(h) {
            var owner = h && h.owner && h.owner.username;
            return owner !== 'Invader' && owner !== 'Source Keeper';
        })) state.lastPlayerHostileTick = Game.time;
    }
    if (state.lastRunTick === Game.time) return {status: state.status};
    if (state.paused || config.paused) return result(state, 'paused');
    if (state.replanRequested && state.mode !== 'observe') return result(state, 'needsObserveReplan');
    if (state.replanRequested && state.mode === 'observe') {
        delete state.plan;
        delete state.planVersion;
        delete state.replanRequested;
    }
    var ownedSpawns = spawns.filter(function(s) { return s && s.my && s.structureType === 'spawn'; });
    var primary = state.plan
        ? ownedSpawns.filter(function(s) { return s.id === state.plan.anchorId; })[0]
        : ownedSpawns.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); })[0];
    if (state.plan && (!primary || (state.plan.anchorPos && (!primary.pos
        || state.plan.anchorPos.x !== primary.pos.x || state.plan.anchorPos.y !== primary.pos.y)))) {
        return result(state, 'anchorChanged');
    }
    if (state.plan && state.planVersion !== PLAN_VERSION) return result(state, 'versionMismatch');
    if (!state.plan) {
        if (Number.isInteger(state.retryAfter) && Game.time < state.retryAfter) {
            return result(state, 'retryCooldown');
        }
        if (!Game.cpu || Game.cpu.bucket < 8000) return result(state, 'lowBucket');
        var snap = deps.survey.survey(room);
        if (!snap.eligible) return result(state, 'ineligible', snap.reason);
        var proposal = deps.compose.compose(snap, deps,
            {perimeter: false, extensionLimit: 60});
        if (!proposal.valid) {
            state.lastBlockers = proposal.blockers.slice(0, 8);
            state.retryAfter = Game.time + 500;
            return result(state, 'blocked', proposal.blockers[0]);
        }
        delete state.retryAfter;
        proposal.anchorPos = {x: snap.anchor.pos.x, y: snap.anchor.pos.y};
        state.plan = proposal;
        state.planVersion = PLAN_VERSION;
        state.generatedTick = Game.time;
        state.lastRunTick = Game.time;
        return result(state, state.mode === 'place' ? 'planned' : 'observing');
    }
    if (state.mode === 'observe') {
        state.lastRunTick = Game.time;
        return result(state, 'observing');
    }
    if (state.generatedTick >= Game.time) return result(state, 'planned');
    // A finished plan, or one waiting on RCL caps, only needs a look every 50 ticks,
    // unless something that unlocks work changed: controller level, a site finishing
    // (vital ramparts wait for their structure), or the typeLimits/minRcl policy.
    var mySites = room.find(typeof FIND_MY_CONSTRUCTION_SITES !== 'undefined'
        ? FIND_MY_CONSTRUCTION_SITES : 'myConstructionSites');
    var wake = room.controller.level + ':' + (Array.isArray(mySites) ? mySites.length : -1) + ':'
        + JSON.stringify([config.typeLimits, state.typeLimits, config.minRcl, state.minRcl]);
    if ((state.status === 'complete' || state.status === 'deferred')
        && Number.isInteger(state.lastExecuteTick) && Game.time - state.lastExecuteTick < 50
        && state.lastExecuteWake === wake) {
        return {status: state.status};
    }
    state.lastRunTick = Game.time;
    state.lastExecuteTick = Game.time;
    state.lastExecuteWake = wake;
    var pauseUntil = Math.max(Number.isInteger(config.pauseUntil) ? config.pauseUntil : -1,
        Number.isInteger(state.pauseUntil) ? state.pauseUntil : -1);
    var placement = deps.executor.execute(room, state.plan, {
        mode: 'place',
        threatActive: state.threatActive === true || config.threatActive === true,
        combatActive: state.combatActive === true || config.combatActive === true,
        remoteBuildActive: state.remoteBuildActive === true || config.remoteBuildActive === true,
        pauseUntil: pauseUntil,
        roomSiteCap: Number.isInteger(config.roomSiteCap) ? Math.max(0, Math.min(5, config.roomSiteCap)) : 5,
        minCpuBucket: Number.isInteger(config.minCpuBucket) ? Math.max(2000, config.minCpuBucket) : 2000,
        hostileCooldown: Number.isInteger(config.hostileCooldown)
            ? Math.max(1500, config.hostileCooldown) : 1500
    });
    if (placement.status === 'deferred' || placement.status === 'placed') ensureSourceFlag(room, state, deps.executor);
    return result(state, placement.status);
}
module.exports = {run: run};
