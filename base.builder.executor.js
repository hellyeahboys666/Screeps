'use strict';
var access = require('base.builder.access');

// Only this module issues createConstructionSite. Call once per room/tick; mode is
// deliberately required so importing this module is never a live opt-in.
function validPos(pos, roomName) {
    return !!pos && Number.isInteger(pos.x) && Number.isInteger(pos.y)
        && pos.x >= 1 && pos.x <= 48 && pos.y >= 1 && pos.y <= 48
        && (!pos.roomName || pos.roomName === roomName);
}
function same(a, b) { return a.x === b.x && a.y === b.y; }
// Total built + owned-site budget. Room keys override global keys, not the
// whole object. Invalid explicit values fail closed; never remove old assets.
// Defaults match what the bot actually uses: no factory, 3 labs, 4 links
// (2 source, controller, base), and no mineral container before the
// extractor exists at RCL6 (it is the lowest-priority container entry).
// minRcl keeps early energy for extensions/upgrading instead of road/rampart decay.
var DEFAULT_MIN_RCL = {road: 2, rampart: 3};
function defaultLimit(type, level, official) {
    if (type === 'factory') return 0;
    if (type === 'lab') return 3;
    if (type === 'link') return 4;
    if (type === 'container') return level >= 6 ? 4 : 3;
    return official;
}
function policyValue(room, key, type, fallback) {
    var value = fallback;
    var config = typeof Memory !== 'undefined' && Memory.baseBuilder;
    var state = room.memory && room.memory.baseBuilder;
    for (var limits of [config && config[key], state && state[key]]) {
        if (limits && typeof limits === 'object' && !Array.isArray(limits)
            && Object.prototype.hasOwnProperty.call(limits, type)) value = limits[type];
    }
    return value;
}
// Perimeter ramparts (purpose 'perimeter') are opt-in: Memory.baseBuilder.perimeter
// or room.memory.baseBuilder.perimeter (room wins), placed from minRcl.perimeter
// (default 5) once the base can afford their upkeep.
function perimeterEnabled(room) {
    var config = typeof Memory !== 'undefined' && Memory.baseBuilder;
    var state = room.memory && room.memory.baseBuilder;
    if (state && typeof state.perimeter === 'boolean') return state.perimeter;
    return !!(config && config.perimeter === true);
}
function perimeterAllowed(room) {
    if (!perimeterEnabled(room)) return false;
    var minRcl = policyValue(room, 'minRcl', 'perimeter', 5);
    return Number.isInteger(minRcl) && room.controller.level >= minRcl;
}
function typeLimit(room, type) {
    var level = room.controller.level;
    var official = CONTROLLER_STRUCTURES[type] && CONTROLLER_STRUCTURES[type][level];
    if (!Number.isInteger(official)) return 0;
    var minRcl = policyValue(room, 'minRcl', type, DEFAULT_MIN_RCL[type] || 0);
    if (!Number.isInteger(minRcl) || minRcl < 0 || level < minRcl) return 0;
    var limit = policyValue(room, 'typeLimits', type, defaultLimit(type, level, official));
    return Number.isInteger(limit) && limit >= 0 ? Math.min(official, limit) : 0;
}
function currentAccess(room, anchor, structures, sites, sources, minerals, terrain) {
    function copy(o) { return {id: o.id, type: o.structureType, my: o.my, pos: o.pos}; }
    var walls = new Array(2500);
    for (var y = 0; y < 50; y++) for (var x = 0; x < 50; x++) {
        walls[y * 50 + x] = (terrain.get(x, y) & TERRAIN_MASK_WALL) ? 1 : 0;
    }
    return access.create({anchor: copy(anchor), controller: copy(room.controller),
        structures: structures.map(copy), sites: sites.map(copy),
        sources: sources.map(copy), minerals: minerals.map(copy), terrain: walls});
}
function ownStructure(obj) {
    return obj.my === true || ((obj.my === false || obj.my === undefined)
        && (obj.structureType === 'road' || obj.structureType === 'container'));
}
function overlaps(type, structure) {
    var beneath = structure.structureType;
    if (!ownStructure(structure)) return false;
    if (type === 'rampart') return beneath !== 'rampart' && beneath !== 'constructedWall';
    if (type === 'road') return beneath === 'container' || beneath === 'rampart';
    if (type === 'container') return beneath === 'road' || beneath === 'rampart';
    return beneath === 'rampart';
}
function authorizedLink(entry, room, sources, options) {
    if (typeof entry.purpose !== 'string' || entry.purpose.indexOf('sourceLink:') !== 0) return true;
    if (options.allowSourceLinks === true) return true;
    var id = entry.purpose.slice('sourceLink:'.length);
    if (!id || typeof FIND_FLAGS === 'undefined' || typeof COLOR_WHITE === 'undefined') return false;
    var flags = room.find(FIND_FLAGS);
    if (!Array.isArray(flags) || !Array.isArray(sources)) return false;
    return flags.some(function(flag) {
        if (!flag || flag.color !== COLOR_WHITE || !validPos(flag.pos, room.name)) return false;
        var closest = [], distance = Infinity;
        for (var source of sources) {
            if (!source || !source.id || !validPos(source.pos, room.name)) return false;
            var d = Math.max(Math.abs(flag.pos.x - source.pos.x), Math.abs(flag.pos.y - source.pos.y));
            if (d < distance) { distance = d; closest = [source.id]; }
            else if (d === distance) closest.push(source.id);
        }
        // Ambiguous equidistant flags are not evidence that a source is staffed.
        return closest.length === 1 && closest[0] === id;
    });
}
function eligibleTile(entry, room, structures, sites, sources, minerals, terrain) {
    var pos = entry.pos, type = entry.type;
    if (!validPos(pos, room.name)) return false;
    if (sites.some(function(o) { return same(o.pos, pos); })) return false;
    if (same(room.controller.pos, pos) || sources.some(function(o) { return same(o.pos, pos); })) return false;
    var mineral = minerals.some(function(o) { return same(o.pos, pos); });
    if (mineral !== (type === 'extractor')) return false;
    if (type !== 'extractor' && (terrain.get(pos.x, pos.y) & TERRAIN_MASK_WALL)) return false;
    // Non-road/container sites cannot obstruct an open exit's inner edge.
    if (type !== 'road' && type !== 'container') {
        for (var offset = -1; offset <= 1; offset++) {
            if ((pos.x === 1 && !(terrain.get(0, pos.y + offset) & TERRAIN_MASK_WALL))
                || (pos.x === 48 && !(terrain.get(49, pos.y + offset) & TERRAIN_MASK_WALL))
                || (pos.y === 1 && !(terrain.get(pos.x + offset, 0) & TERRAIN_MASK_WALL))
                || (pos.y === 48 && !(terrain.get(pos.x + offset, 49) & TERRAIN_MASK_WALL))) return false;
        }
    }
    return structures.every(function(o) {
        return !same(o.pos, pos) || overlaps(type, o);
    });
}
function compareEntries(a, b) {
    return a.priority - b.priority || String(a.purpose).localeCompare(String(b.purpose))
        || a.pos.y - b.pos.y || a.pos.x - b.pos.x || String(a.type).localeCompare(String(b.type));
}
function executorState(room) {
    if (!room.memory || typeof room.memory !== 'object') return null;
    if (!room.memory.baseBuilder) room.memory.baseBuilder = {};
    if (typeof room.memory.baseBuilder !== 'object' || Array.isArray(room.memory.baseBuilder)) return null;
    var state = room.memory.baseBuilder.executor;
    if (state === undefined) {
        state = {quarantined: {}};
        room.memory.baseBuilder.executor = state;
    }
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
}

/** execute(room, surveySnapshot, completePlan, options) or execute(room, completePlan, options)
 * -> {status, reason?, code?}. The three-argument manager form resolves the
 * current anchor from the live room; both forms verify it against plan.anchorId.
 * options.mode:'place' is mandatory. Safety inputs that a room cannot itself
 * prove (threatActive, combatActive, remoteBuildActive, pauseUntil) are explicit.
 */
function execute(room, snapshot, plan, options) {
    var managerCall = arguments.length === 3;
    if (managerCall) {
        options = plan;
        plan = snapshot;
    }
    if (!options || options.mode !== 'place' || options.dryRun === true
        || options.enabled === false || options.roomEnabled === false) return {status: 'inactive'};
    if (managerCall) {
        // The manager retains a compact proposal, not a 2500-cell survey.
        // Reconstruct only the anchor proof; never trust a stored spawn ID alone.
        var currentSpawns = room && typeof room.find === 'function' && typeof FIND_MY_SPAWNS !== 'undefined'
            ? room.find(FIND_MY_SPAWNS) : null;
        var first = Array.isArray(currentSpawns) ? currentSpawns.filter(function(s) {
            return s && s.my === true && s.structureType === 'spawn'
                && plan && s.id === plan.anchorId;
        })[0] : null;
        snapshot = first && first.pos
            ? {eligible: true, roomName: room.name, anchor: {id: first.id, pos: {x: first.pos.x, y: first.pos.y}}}
            : null;
    }
    if (!room || !room.controller || room.controller.my !== true || !snapshot
        || snapshot.eligible !== true || snapshot.roomName !== room.name
        || !plan || plan.valid !== true || !Array.isArray(plan.entries)
        || !Array.isArray(plan.blockers) || plan.blockers.length
        || (options.planVersion !== undefined && plan.version !== options.planVersion)
        || typeof room.find !== 'function' || typeof room.getTerrain !== 'function'
        || typeof room.createConstructionSite !== 'function') return {status: 'blocked'};
    var spawns = room.find(FIND_MY_SPAWNS);
    if (!Array.isArray(spawns)) return {status: 'blocked'};
    var owned = spawns.filter(function(s) {
        return s && s.my === true && s.structureType === 'spawn' && s.id === plan.anchorId;
    });
    var anchor = owned[0];
    if (!anchor || !snapshot.anchor || !snapshot.anchor.pos || !anchor.pos
        || plan.anchorId !== anchor.id || snapshot.anchor.id !== anchor.id
        || (plan.anchorPos && (!validPos(plan.anchorPos, room.name)
            || plan.anchorPos.x !== anchor.pos.x || plan.anchorPos.y !== anchor.pos.y))
        || snapshot.anchor.pos.x !== anchor.pos.x || snapshot.anchor.pos.y !== anchor.pos.y) return {status: 'blocked'};
    if (typeof Game === 'undefined' || !Number.isInteger(Game.time) || !Game.cpu
        || !Number.isFinite(Game.cpu.bucket)) return {status: 'paused', reason: 'cpuUnavailable'};
    var hostiles = room.find(FIND_HOSTILE_CREEPS);
    var hostilePowerCreeps = typeof FIND_HOSTILE_POWER_CREEPS === 'undefined'
        ? [] : room.find(FIND_HOSTILE_POWER_CREEPS);
    if (!Array.isArray(hostiles) || hostiles.length
        || !Array.isArray(hostilePowerCreeps) || hostilePowerCreeps.length
        || options.threatActive === true || options.combatActive === true
        || options.remoteBuildActive === true || options.pauseUntil >= Game.time
        || Game.cpu.bucket < (options.minCpuBucket === undefined ? 2000 : options.minCpuBucket)) {
        return {status: 'paused', reason: 'dangerOrCpu'};
    }
    var last = room.memory && room.memory.baseBuilder && room.memory.baseBuilder.lastPlayerHostileTick;
    var cooldown = options.hostileCooldown === undefined ? 1500 : options.hostileCooldown;
    if (Number.isInteger(last) && last <= Game.time && Game.time - last < cooldown) {
        return {status: 'paused', reason: 'recentPlayerHostile'};
    }
    var structures = room.find(FIND_STRUCTURES), sites = room.find(FIND_CONSTRUCTION_SITES);
    var sources = room.find(FIND_SOURCES), minerals = room.find(FIND_MINERALS);
    var terrain = room.getTerrain();
    if (!Array.isArray(structures) || !Array.isArray(sites) || !Array.isArray(sources)
        || !Array.isArray(minerals) || !terrain || typeof terrain.get !== 'function'
        || !Game.constructionSites || typeof Game.constructionSites !== 'object'
        || typeof CONTROLLER_STRUCTURES === 'undefined' || typeof MAX_CONSTRUCTION_SITES !== 'number'
        || plan.entries.some(function(e) {
            return !e || !validPos(e.pos, room.name) || typeof e.type !== 'string'
                || !CONTROLLER_STRUCTURES[e.type] || !Number.isFinite(e.priority)
                || (e.requiresType !== undefined && (e.type !== 'rampart'
                    || !Object.prototype.hasOwnProperty.call(CONTROLLER_STRUCTURES, e.requiresType)));
        }) || structures.concat(sites, sources, minerals).some(function(o) {
            return !o || !o.pos || !Number.isInteger(o.pos.x) || !Number.isInteger(o.pos.y);
        })) return {status: 'blocked', reason: 'invalidState'};
    if (Object.keys(Game.constructionSites).length >= MAX_CONSTRUCTION_SITES
        || sites.filter(function(s) { return s.my === true; }).length >=
            (options.roomSiteCap === undefined ? 5 : options.roomSiteCap)) {
        return {status: 'paused', reason: 'siteBudget'};
    }
    if (!plan.entries.length) return {status: 'complete'};
    var state = executorState(room);
    if (!state) return {status: 'blocked', reason: 'invalidMemory'};
    if (!state.quarantined || typeof state.quarantined !== 'object' || Array.isArray(state.quarantined)) {
        return {status: 'blocked', reason: 'invalidMemory'};
    }
    var baseBuilder = room.memory.baseBuilder;
    var identity = String(plan.anchorId) + ':' + String(plan.version === undefined ? '' : plan.version)
        + ':' + String(baseBuilder.planVersion === undefined ? '' : baseBuilder.planVersion)
        + ':' + String(Number.isInteger(baseBuilder.generatedTick) ? baseBuilder.generatedTick : '');
    if (state.planIdentity !== identity) {
        state.planIdentity = identity;
        state.quarantined = {};
        state.backoffUntil = 0;
    }
    if (state.lastAttemptTick === Game.time) return {status: 'paused', reason: 'attemptOrBackoff'};
    if (state.rclErrorLevel !== undefined && state.rclErrorLevel !== room.controller.level) {
        state.backoffUntil = 0;
        delete state.rclErrorLevel;
    }
    if (Number.isInteger(state.backoffUntil) && state.backoffUntil > Game.time) {
        return {status: 'paused', reason: 'attemptOrBackoff'};
    }
    var sorted = plan.entries.slice().sort(compareEntries);
    var waiting = false, guard;
    for (var entry of sorted) {
        var pos = entry.pos, type = entry.type;
        if (structures.concat(sites).some(function(o) {
            return o.structureType === type && same(o.pos, pos) && ownStructure(o);
        })) continue;
        // Future vital overlays must wait for the real underlying structure,
        // including types intentionally disabled by policy or future RCL caps.
        if (entry.purpose === 'perimeter' && !perimeterAllowed(room)) { waiting = true; continue; }
        if (entry.requiresType && !structures.some(function(o) {
            return o.my === true && o.structureType === entry.requiresType && same(o.pos, pos);
        })) { waiting = true; continue; }
        var key = type + ':' + pos.x + ':' + pos.y;
        if (state.quarantined[key]) { waiting = true; continue; }
        var cap = typeLimit(room, type);
        var count = structures.filter(function(o) { return o.structureType === type && ownStructure(o); }).length
            + sites.filter(function(o) { return o.structureType === type && o.my === true; }).length;
        if (!Number.isInteger(cap) || count >= cap || !authorizedLink(entry, room, sources, options)) {
            waiting = true;
            continue;
        }
        if (!eligibleTile(entry, room, structures, sites, sources, minerals, terrain)) { waiting = true; continue; }
        // Stored plans can become unsafe after manual construction. Recheck the
        // eventual hard obstacles (including pending sites) before issuing an
        // intent; one small room flood per candidate, no persistent terrain.
        if (!access.passable(type)) {
            if (!guard) guard = currentAccess(room, anchor, structures, sites, sources, minerals, terrain);
            if (guard.check([entry])) { waiting = true; continue; }
        }
        var spawnName;
        if (type === 'spawn') {
            spawnName = 'BB-' + room.name + '-' + pos.x + '-' + pos.y;
            if (!Game.spawns || typeof Game.spawns !== 'object'
                || spawnName.length > 100 || Game.spawns[spawnName]
                || Object.keys(Game.constructionSites).some(function(id) {
                    return Game.constructionSites[id] && Game.constructionSites[id].name === spawnName;
                }) || sites.some(function(site) { return site.name === spawnName; })) {
                waiting = true;
                continue;
            }
        }
        state.lastAttemptTick = Game.time; // reserve before API call, including thrown exceptions
        var code;
        try {
            code = type === 'spawn'
                ? room.createConstructionSite(pos.x, pos.y, type, spawnName)
                : room.createConstructionSite(pos.x, pos.y, type);
        }
        catch (error) { state.backoffUntil = Game.time + 25; return {status: 'error', reason: 'apiException'}; }
        state.lastCode = code;
        state.lastEntry = key;
        if (code === OK) return {status: 'placed', code: code, entry: entry};
        if (code === ERR_INVALID_TARGET) state.quarantined[key] = true;
        else {
            state.backoffUntil = Game.time + (code === ERR_RCL_NOT_ENOUGH ? 10 : 25);
            if (code === ERR_RCL_NOT_ENOUGH) state.rclErrorLevel = room.controller.level;
        }
        return {status: 'error', code: code, entry: entry};
    }
    return {status: waiting ? 'deferred' : 'complete'};
}
// Final (RCL8) count the policy allows; the planner reserves space only for this.
function planLimit(room, type) {
    var official = CONTROLLER_STRUCTURES[type] && CONTROLLER_STRUCTURES[type][8];
    if (!Number.isInteger(official)) return 0;
    var limit = policyValue(room, 'typeLimits', type, defaultLimit(type, 8, official));
    return Number.isInteger(limit) && limit >= 0 ? Math.min(official, limit) : 0;
}
module.exports = {execute: execute, typeLimit: typeLimit, planLimit: planLimit, perimeterEnabled: perimeterEnabled};
