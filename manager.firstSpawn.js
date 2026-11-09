'use strict';

// Opt-in first-spawn manager. Its only world intent is a guarded spawn site in place mode.
const SHORTLIST_LIMIT = 64;
const MIN_PLANNING_BUCKET = 8000;
function legal(pos) {
    return pos && Number.isInteger(pos.x) && Number.isInteger(pos.y)
        && pos.x >= 2 && pos.x <= 47 && pos.y >= 2 && pos.y <= 47;
}
function same(a, b) { return a && b && a.x === b.x && a.y === b.y; }
function fingerprint(snapshot) {
    // Compact deterministic proof of the terrain and room topology, never the 2500-cell array.
    let hash = 2166136261;
    function add(value) {
        const text = String(value);
        for (let i = 0; i < text.length; i++) {
            hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
        }
        hash = Math.imul(hash ^ 255, 16777619) >>> 0;
    }
    add(snapshot.roomName);
    for (const tile of snapshot.terrain) add(tile);
    for (const kind of ['controller', 'sources', 'minerals', 'structures', 'sites', 'spawns']) {
        const list = kind === 'controller' ? [snapshot.controller] : snapshot[kind];
        if (!Array.isArray(list)) return null;
        const entries = list.map(o => o && o.pos && [o.id, o.type, o.my, o.pos.x, o.pos.y].join(':'));
        if (entries.some(e => typeof e !== 'string')) return null;
        for (const entry of entries.sort()) add(kind + ':' + entry);
    }
    return hash.toString(36);
}
function outcome(state, status, reason) {
    state.status = status;
    return reason ? {status, reason} : {status};
}
function run(room, request, deps) {
    if (!request || (request.mode !== 'observe' && request.mode !== 'place')
        || typeof request.home !== 'string' || !request.home
        || typeof request.target !== 'string' || !room
        || request.target !== room.name) return {status: 'off'};
    const config = typeof Memory !== 'undefined' && Memory.baseBuilder;
    if (!config || config.disabled === true) return {status: 'off'};
    if (config.paused === true || config.firstSpawnPaused === true) return {status: 'paused'};
    if (!room.controller || room.controller.my !== true || typeof Game === 'undefined'
        || !Game.rooms || Game.rooms[room.name] !== room
        || typeof room.find !== 'function') return {status: 'ineligible'};
    const spawns = room.find(FIND_MY_SPAWNS);
    if (!Array.isArray(spawns)) return {status: 'ineligible'};
    if (spawns.some(spawn => spawn && spawn.my === true
        && spawn.structureType === STRUCTURE_SPAWN)) return {status: 'alreadySpawned'};
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    if (!Array.isArray(sites)) return {status: 'ineligible'};
    if (sites.some(site => site && site.structureType === 'spawn')) {
        return {status: 'existingSpawnSite'};
    }
    if (!room.memory || typeof room.memory !== 'object') return {status: 'ineligible'};
    const builder = room.memory.baseBuilder || (room.memory.baseBuilder = {});
    if (typeof builder !== 'object' || Array.isArray(builder)) return {status: 'ineligible'};
    const state = builder.firstSpawn || (builder.firstSpawn = {});
    if (typeof state !== 'object' || Array.isArray(state)) return {status: 'ineligible'};
    if (state.siteName) {
        // A placed site shows up the next tick. If it's still missing after that,
        // it was stomped or never created: forget it and plan again.
        if (Game.time - state.lastAttemptTick <= 1) return outcome(state, 'awaitingSiteReadback');
        delete state.siteName;
        delete state.sitePos;
        state.signature = null;
    }
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const powerHostiles = typeof FIND_HOSTILE_POWER_CREEPS === 'undefined'
        ? [] : room.find(FIND_HOSTILE_POWER_CREEPS);
    if (!Array.isArray(hostiles) || !Array.isArray(powerHostiles)) {
        return outcome(state, 'paused', 'unknownThreatState');
    }
    const seen = room.memory.hostilePlayerLastSeen;
    if (Number.isInteger(seen) && seen <= Game.time
        && (!Number.isInteger(state.lastPlayerHostileTick) || seen > state.lastPlayerHostileTick)) {
        state.lastPlayerHostileTick = seen;
    }
    if (hostiles.concat(powerHostiles).some(creep => {
        const owner = creep && creep.owner && creep.owner.username;
        if (owner !== 'Invader' && owner !== 'Source Keeper') {
            state.lastPlayerHostileTick = Game.time;
        }
        return true;
    })) return outcome(state, 'paused', 'currentHostiles');
    if (Number.isInteger(state.lastPlayerHostileTick)
        && Game.time - state.lastPlayerHostileTick < 1500) {
        return outcome(state, 'paused', 'recentPlayerHostile');
    }
    if (state.lastRunTick === Game.time) return {status: state.status};
    state.lastRunTick = Game.time;
    if (!Game.cpu || !Number.isFinite(Game.cpu.bucket)
        || Game.cpu.bucket < MIN_PLANNING_BUCKET) return outcome(state, 'paused', 'lowBucket');
    // Once ranking is done, only re-survey now and then while just observing.
    if ((state.status === 'rejected' || (state.status === 'observing' && request.mode !== 'place'))
        && Number.isInteger(state.lastSurveyTick) && Game.time - state.lastSurveyTick < 100) {
        return {status: state.status};
    }
    state.lastSurveyTick = Game.time;
    if (!deps || !deps.survey || !deps.firstSpawn
        || typeof deps.survey.survey !== 'function'
        || typeof deps.firstSpawn.rankCandidates !== 'function'
        || typeof deps.firstSpawn.evaluateCandidate !== 'function') {
        return outcome(state, 'ineligible', 'missingPlanner');
    }
    const snapshot = deps.survey.survey(room, {allowNoSpawn: true});
    if (!snapshot || snapshot.eligible !== true || snapshot.roomName !== room.name
        || !Array.isArray(snapshot.terrain) || snapshot.terrain.length !== 2500) {
        return outcome(state, 'ineligible', snapshot && snapshot.reason);
    }
    const signature = fingerprint(snapshot);
    if (signature === null) return outcome(state, 'ineligible', 'invalidSnapshot');
    if (state.signature !== signature || state.home !== request.home
        || !Array.isArray(state.candidates)) {
        const ranking = deps.firstSpawn.rankCandidates(snapshot, SHORTLIST_LIMIT);
        state.home = request.home;
        state.signature = signature;
        state.candidates = (ranking && Array.isArray(ranking.candidates) ? ranking.candidates : [])
            .slice(0, SHORTLIST_LIMIT).filter(c => legal(c.pos) && Number.isFinite(c.score))
            .map(c => ({pos: {x: c.pos.x, y: c.pos.y}, score: c.score}));
        state.cursor = 0;
        state.best = null;
        state.diagnostics = {rejected: 0, blockers: []};
        state.plannedTick = null;
    }
    if (state.cursor < state.candidates.length) {
        const candidate = state.candidates[state.cursor++];
        const result = deps.firstSpawn.evaluateCandidate(snapshot, candidate, deps);
        if (result && result.valid === true && same(result.pos, candidate.pos)
            && Number.isFinite(result.score)) {
            const best = state.best;
            if (!best || result.score < best.score
                || (result.score === best.score && (candidate.pos.y < best.pos.y
                    || (candidate.pos.y === best.pos.y && candidate.pos.x < best.pos.x)))) {
                state.best = {pos: candidate.pos, score: result.score,
                    rankScore: candidate.score, extensionCount: result.extensionCount};
            }
        } else {
            state.diagnostics.rejected++;
            const blocker = result && Array.isArray(result.blockers) ? result.blockers[0] : 'invalidLayout';
            if (state.diagnostics.blockers.length < 8) state.diagnostics.blockers.push(String(blocker));
        }
        if (state.cursor < state.candidates.length) return outcome(state, 'planning');
    }
    if (!Number.isInteger(state.plannedTick)) {
        state.plannedTick = Game.time;
        return outcome(state, state.best ? 'observing' : 'rejected');
    }
    if (!state.best) return outcome(state, 'rejected');
    if (request.mode !== 'place' || state.plannedTick >= Game.time) return outcome(state, 'observing');
    if (Number.isInteger(state.retryAfter) && Game.time < state.retryAfter) {
        return outcome(state, 'deferred', 'apiBackoff');
    }
    const selected = state.best.pos;
    if (!legal(selected) || snapshot.terrain[selected.y * 50 + selected.x]
        || snapshot.structures.concat(snapshot.sites, snapshot.sources,
            snapshot.minerals, [snapshot.controller]).some(o => same(o.pos, selected))) {
        return outcome(state, 'blocked', 'invalidSelectedTile');
    }
    if (!Game.constructionSites || typeof Game.constructionSites !== 'object'
        || typeof MAX_CONSTRUCTION_SITES !== 'number'
        || Object.keys(Game.constructionSites).length >= MAX_CONSTRUCTION_SITES) {
        return outcome(state, 'deferred', 'globalSiteCap');
    }
    const roomSiteCap = Number.isInteger(config.roomSiteCap)
        ? Math.max(0, Math.min(5, config.roomSiteCap)) : 5;
    if (sites.filter(s => s && s.my === true).length >= roomSiteCap) {
        return outcome(state, 'deferred', 'roomSiteCap');
    }
    const spawnCap = typeof CONTROLLER_STRUCTURES !== 'undefined'
        && CONTROLLER_STRUCTURES[STRUCTURE_SPAWN]
        && CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][room.controller.level];
    if (!Number.isInteger(spawnCap) || spawnCap < 1) {
        return outcome(state, 'deferred', 'spawnRclCap');
    }
    const fresh = deps.firstSpawn.evaluateCandidate(snapshot,
        {pos: selected, score: state.best.rankScore}, deps);
    if (!fresh || fresh.valid !== true || !same(fresh.pos, selected)) {
        state.signature = null;
        return outcome(state, 'blocked', 'staleSelectedTile');
    }
    const name = 'BB-' + room.name + '-' + selected.x + '-' + selected.y;
    if (name.length > 100 || !Game.spawns || typeof Game.spawns !== 'object'
        || Game.spawns[name] || Object.values(Game.constructionSites).some(site =>
            site && site.name === name) || sites.some(site => site && site.name === name)) {
        return outcome(state, 'blocked', 'spawnNameConflict');
    }
    state.lastAttemptTick = Game.time; // reserve this tick before calling the API
    let code;
    try {
        code = room.createConstructionSite(selected.x, selected.y, STRUCTURE_SPAWN, name);
    } catch (error) {
        state.lastAttemptResult = 'exception';
        state.retryAfter = Game.time + 500;
        return outcome(state, 'deferred', 'siteException');
    }
    state.lastAttemptResult = code;
    if (code === OK) {
        state.siteName = name;
        state.sitePos = {x: selected.x, y: selected.y};
        return outcome(state, 'placed');
    }
    state.retryAfter = Game.time + (code === ERR_INVALID_TARGET ? 500 : 25);
    return outcome(state, 'deferred', String(code));
}

module.exports = {run};
