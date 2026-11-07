'use strict';
// Runs once per tick after claim intents and hostile telemetry. No implicit
// first-spawn enrollment: only an explicit recorded claim or opted-in mission.
function roomName(name) { return typeof name === 'string' && /^[WE]\d+[NS]\d+$/.test(name); }
function isMode(mode) { return mode === 'observe' || mode === 'place'; }
function recordClaim(target, home) {
    if (typeof Memory === 'undefined' || !Memory.baseBuilder
        || !isMode(Memory.baseBuilder.firstSpawnMode)
        || !roomName(target) || !roomName(home)
        || typeof Game === 'undefined' || !Number.isInteger(Game.time)) return false;
    var config = Memory.baseBuilder;
    if (!config.firstSpawnClaims) config.firstSpawnClaims = {};
    if (typeof config.firstSpawnClaims !== 'object' || Array.isArray(config.firstSpawnClaims)) return false;
    var prior = config.firstSpawnClaims[target], mode = config.firstSpawnMode;
    if (prior) return prior.home === home && prior.mode === mode;
    config.firstSpawnClaims[target] = {target: target, home: home, mode: mode,
        requestedTick: Game.time};
    return true;
}
function modules() {
    return {
        manager: require('manager.firstSpawn'),
        survey: require('base.builder.survey'),
        firstSpawn: require('base.builder.firstSpawn'),
        compose: require('base.builder.compose'),
        core: require('base.builder.plan'),
        paths: require('base.builder.paths'),
        infrastructure: require('base.builder.infrastructure'),
        expansion: require('base.builder.expansion'),
        extensions: require('base.builder.extensions'),
        defense: require('base.builder.defense')
    };
}
function missionRequests() {
    var raw = Memory.remoteBuildMissions;
    if (!raw || typeof raw !== 'object') return [];
    var entries = Array.isArray(raw) ? raw.map(function(data, i) { return [String(i), data]; })
        : Object.keys(raw).sort().map(function(key) { return [key, raw[key]]; });
    var requests = [];
    for (var entry of entries) {
        var key = entry[0], data = entry[1];
        if (!data || typeof data !== 'object' || data.active === false) continue;
        var mode = data.autoFirstSpawn === true ? 'place' : data.autoFirstSpawn;
        var target = data.target || data.targetRoom || (roomName(key) ? key : null);
        var home = data.home || data.homeRoom;
        if (!isMode(mode) || !roomName(target) || !roomName(home)) continue;
        requests.push({target: target, home: home, mode: mode});
    }
    return requests;
}
function run(injected) {
    if (typeof Game === 'undefined' || !Game.rooms || typeof Memory === 'undefined') return [];
    var config = Memory.baseBuilder;
    if (config && (typeof config !== 'object' || Array.isArray(config))) return [];
    config = config || {};
    if (config.disabled === true || config.paused === true
        || config.firstSpawnPaused === true) return [];
    var claims = config.firstSpawnClaims || {}, requests = [], responses = [];
    if (claims && typeof claims === 'object' && !Array.isArray(claims)) {
        for (var key of Object.keys(claims).sort()) {
            var c = claims[key];
            if (c && roomName(key) && c.target === key && roomName(c.home)
                && isMode(c.mode)) requests.push({target: key, home: c.home, mode: c.mode});
        }
    }
    requests.push.apply(requests, missionRequests());
    if (!requests.length) return [];
    if (!Memory.baseBuilder) Memory.baseBuilder = config;
    var byTarget = {};
    for (var candidate of requests) {
        var prior = byTarget[candidate.target];
        if (!prior) byTarget[candidate.target] = candidate;
        else if (prior.home !== candidate.home || prior.mode !== candidate.mode) {
            byTarget[candidate.target] = {target: candidate.target, conflict: true};
        }
    }
    var deps = injected || modules();
    for (var target of Object.keys(byTarget).sort()) {
        var request = byTarget[target];
        if (request.conflict) {
            responses.push({room: target, status: 'conflictingRequests'});
            continue;
        }
        var room = Game.rooms[request.target];
        if (!room) { responses.push({room: request.target, status: 'notVisible'}); continue; }
        var state = room.memory && room.memory.baseBuilder;
        if (state && Number.isInteger(state.firstSpawnRuntimeBackoffUntil)
            && Game.time < state.firstSpawnRuntimeBackoffUntil) continue;
        try {
            var result = deps.manager.run(room, request, deps);
            responses.push({room: request.target, status: result.status});
        } catch (error) {
            if (room.memory) {
                var bb = room.memory.baseBuilder || (room.memory.baseBuilder = {});
                bb.firstSpawnRuntimeError = String(error && error.message || error).slice(0, 120);
                bb.firstSpawnRuntimeBackoffUntil = Game.time + 500;
            }
            responses.push({room: request.target, status: 'error'});
        }
    }
    return responses;
}
module.exports = {recordClaim, run};
