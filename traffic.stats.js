var WINDOW_TICKS = 1500;
var MAX_STUCK_CREEPS = 10;
var MAX_STUCK_SITES = 12;
var MAX_STUCK_SITE_BLOCKERS = 6;
var MAX_SUMMARY_BUCKETS = 5;
var STUCK_REPORT_TICKS = 3;

function isEnabled()
{
    return Memory.trafficStatsEnabled == true;
}

function copyNumericFields(source)
{
    var out = {};
    for (var key in source || {})
    {
        if (typeof source[key] == 'number')
        {
            out[key] = source[key];
        }
    }
    return out;
}

function topNumericBucket(bucket, field, limit)
{
    var rows = [];
    for (var key in bucket || {})
    {
        var entry = bucket[key];
        if (entry && typeof entry[field] == 'number' && entry[field] > 0)
        {
            rows.push({ key: key, value: entry[field], entry: entry });
        }
    }
    rows.sort(function(a, b) {
        if (b.value != a.value)
        {
            return b.value - a.value;
        }
        return a.key < b.key ? -1 : 1;
    });
    var out = {};
    for (var i = 0; i < rows.length && i < limit; i++)
    {
        out[rows[i].key] = copyNumericFields(rows[i].entry);
    }
    return out;
}

function topCountBucket(bucket, limit)
{
    var rows = [];
    for (var key in bucket || {})
    {
        if (typeof bucket[key] == 'number' && bucket[key] > 0)
        {
            rows.push({ key: key, value: bucket[key] });
        }
    }
    rows.sort(function(a, b) {
        if (b.value != a.value)
        {
            return b.value - a.value;
        }
        return a.key < b.key ? -1 : 1;
    });
    var out = {};
    for (var i = 0; i < rows.length && i < limit; i++)
    {
        out[rows[i].key] = rows[i].value;
    }
    return out;
}

function summarizeBlockers(blockers, limit)
{
    var rows = [];
    for (var key in blockers || {})
    {
        var entry = blockers[key];
        if (entry)
        {
            rows.push({ key: key, value: entry.samples || 0, entry: entry });
        }
    }
    rows.sort(function(a, b) {
        if (b.value != a.value)
        {
            return b.value - a.value;
        }
        return (b.entry.updated || 0) - (a.entry.updated || 0);
    });
    var out = {};
    for (var i = 0; i < rows.length && i < limit; i++)
    {
        var e = rows[i].entry;
        out[rows[i].key] = {
            name: e.name,
            role: e.role,
            roomName: e.roomName,
            x: e.x,
            y: e.y,
            fatigue: e.fatigue || 0,
            samples: e.samples || 0,
            onStep: e.onStep == true,
            updated: e.updated
        };
    }
    return out;
}

function summarizeStuckCreeps(creeps)
{
    var rows = [];
    for (var name in creeps || {})
    {
        var entry = creeps[name];
        if (entry)
        {
            rows.push({
                name: name,
                score: (entry.samples || 0) * 100 + (entry.maxStuckTicks || entry.stuckTicks || 0),
                entry: entry
            });
        }
    }
    rows.sort(function(a, b) {
        if (b.score != a.score)
        {
            return b.score - a.score;
        }
        return (b.entry.updated || 0) - (a.entry.updated || 0);
    });
    var out = {};
    for (var i = 0; i < rows.length && i < MAX_STUCK_CREEPS; i++)
    {
        var e = rows[i].entry;
        out[rows[i].name] = {
            role: e.role,
            roomName: e.roomName,
            x: e.x,
            y: e.y,
            fatigue: e.fatigue || 0,
            stuckTicks: e.stuckTicks || 0,
            maxStuckTicks: e.maxStuckTicks || e.stuckTicks || 0,
            samples: e.samples || 0,
            dest: e.dest,
            updated: e.updated,
            blockers: e.blockers || []
        };
    }
    return out;
}

function summarizeStuckSites(sites)
{
    var rows = [];
    for (var key in sites || {})
    {
        var entry = sites[key];
        if (entry)
        {
            rows.push({
                key: key,
                score: (entry.samples || 0) * 100 + (entry.maxStuckTicks || 0),
                entry: entry
            });
        }
    }
    rows.sort(function(a, b) {
        if (b.score != a.score)
        {
            return b.score - a.score;
        }
        return (b.entry.updated || 0) - (a.entry.updated || 0);
    });
    var out = {};
    for (var i = 0; i < rows.length && i < MAX_STUCK_SITES; i++)
    {
        var e = rows[i].entry;
        out[rows[i].key] = {
            roomName: e.roomName,
            x: e.x,
            y: e.y,
            samples: e.samples || 0,
            maxStuckTicks: e.maxStuckTicks || 0,
            lastCreep: e.lastCreep,
            lastRole: e.lastRole,
            lastDest: e.lastDest,
            updated: e.updated,
            roles: topCountBucket(e.roles, 4),
            blockers: summarizeBlockers(e.blockers, MAX_STUCK_SITE_BLOCKERS),
            lastBlockers: e.lastBlockers || []
        };
    }
    return out;
}

function makeSummary(stats)
{
    return {
        windowStart: stats.windowStart,
        updated: stats.updated,
        windowTicks: stats.windowTicks || 0,
        creepsSeen: stats.creepsSeen || 0,
        moveIntentTicks: stats.moveIntentTicks || 0,
        movedTicks: stats.movedTicks || 0,
        stuckTicks: stats.stuckTicks || 0,
        fatigueTicks: stats.fatigueTicks || 0,
        moveAsideRequestTicks: stats.moveAsideRequestTicks || 0,
        trafficYieldRequestTicks: stats.trafficYieldRequestTicks || 0,
        spawnDropBlockerTicks: stats.spawnDropBlockerTicks || 0,
        duplicateLorryPickupTargetTicks: stats.duplicateLorryPickupTargetTicks || 0,
        topStuckRoles: topNumericBucket(stats.roles, 'stuckTicks', MAX_SUMMARY_BUCKETS),
        topStuckRooms: topNumericBucket(stats.rooms, 'stuckTicks', MAX_SUMMARY_BUCKETS),
        topFatigueRoles: topNumericBucket(stats.roles, 'fatigueTicks', MAX_SUMMARY_BUCKETS),
        topFatigueRooms: topNumericBucket(stats.rooms, 'fatigueTicks', MAX_SUMMARY_BUCKETS),
        stuckCreeps: summarizeStuckCreeps(stats.stuckCreeps),
        stuckSites: summarizeStuckSites(stats.stuckSites)
    };
}

function ensureStats()
{
    var existing = Memory.trafficStats;
    if (!existing
        || existing.windowStart == undefined
        || Game.time - existing.windowStart >= WINDOW_TICKS)
    {
        var history = existing && existing.history ? existing.history : [];
        if (existing && existing.windowStart != undefined)
        {
            history.unshift(makeSummary(existing));
        }
        while (history.length > 5)
        {
            history.pop();
        }
        Memory.trafficStats = {
            windowStart: Game.time,
            windowTicks: 0,
            updated: Game.time,
            creepsSeen: 0,
            moveIntentTicks: 0,
            movedTicks: 0,
            stuckTicks: 0,
            fatigueTicks: 0,
            moveAsideRequestTicks: 0,
            trafficYieldRequestTicks: 0,
            spawnDropBlockerTicks: 0,
            duplicateLorryPickupTargetTicks: 0,
            roles: {},
            rooms: {},
            stuckCreeps: {},
            stuckSites: {},
            lastDuplicateLorryPickups: {},
            history: history
        };
    }
    var stats = Memory.trafficStats;
    stats.roles = stats.roles || {};
    stats.rooms = stats.rooms || {};
    stats.stuckCreeps = stats.stuckCreeps || {};
    stats.stuckSites = stats.stuckSites || {};
    stats.lastDuplicateLorryPickups = stats.lastDuplicateLorryPickups || {};
    stats.history = stats.history || [];
    return stats;
}

function ensureScratch()
{
    if (!global.trafficStatsScratch || global.trafficStatsScratch.tick != Game.time)
    {
        global.trafficStatsScratch = {
            tick: Game.time,
            lorryPickupCounts: {}
        };
    }
    return global.trafficStatsScratch;
}

function beginTick()
{
    if (!isEnabled())
    {
        return;
    }
    var stats = ensureStats();
    ensureScratch();
    if (stats.lastTick != Game.time)
    {
        stats.windowTicks = (stats.windowTicks || 0) + 1;
        stats.lastTick = Game.time;
        stats.updated = Game.time;
        stats.lastDuplicateLorryPickups = {};
    }
}

function getRole(creep)
{
    if (!creep || !creep.memory || !creep.memory.role)
    {
        return 'unknown';
    }
    return creep.memory.role;
}

function inc(bucket, key, amount)
{
    bucket[key] = (bucket[key] || 0) + (amount || 1);
}

function getBucket(parent, key)
{
    key = key || 'unknown';
    if (!parent[key])
    {
        parent[key] = {};
    }
    return parent[key];
}

function hasMoveIntentFromState(state)
{
    return state && state.hadMoveIntent == true;
}

function hasMoveIntent(creep)
{
    return !!(creep.memory
        && creep.memory._move
        && creep.memory._move.dest
        && creep.memory._move.time == Game.time);
}

function getMoveDestKey(creep)
{
    if (!hasMoveIntent(creep))
    {
        return undefined;
    }
    var dest = creep.memory._move.dest;
    return (dest.room || dest.roomName || creep.room.name) + ':' + dest.x + ':' + dest.y;
}

function isAtSpawnDropSpot(creep)
{
    if (!creep.room
        || !creep.room.memory
        || !creep.room.memory.spawnEnergyDropSpot)
    {
        return false;
    }
    var spot = creep.room.memory.spawnEnergyDropSpot;
    return creep.pos.x == spot.x
        && creep.pos.y == spot.y
        && creep.pos.roomName == (spot.roomName || creep.room.name);
}

function isHaulerRole(role)
{
    return role == 'lorry' || role == 'remoteLorry' || role == 'remoteCarrier';
}

function parseDestKey(dest)
{
    if (!dest || typeof dest != 'string')
    {
        return undefined;
    }
    var parts = dest.split(':');
    if (parts.length != 3)
    {
        return undefined;
    }
    var x = parseInt(parts[1], 10);
    var y = parseInt(parts[2], 10);
    if (isNaN(x) || isNaN(y))
    {
        return undefined;
    }
    return { roomName: parts[0], x: x, y: y };
}

function clampRoomCoord(v)
{
    return Math.max(0, Math.min(49, v));
}

function getStepTowardDest(creep, prev)
{
    var dest = parseDestKey(prev ? prev.dest : undefined);
    if (!dest || dest.roomName != creep.pos.roomName)
    {
        return undefined;
    }
    var dx = dest.x > creep.pos.x ? 1 : (dest.x < creep.pos.x ? -1 : 0);
    var dy = dest.y > creep.pos.y ? 1 : (dest.y < creep.pos.y ? -1 : 0);
    if (dx == 0 && dy == 0)
    {
        return undefined;
    }
    return {
        roomName: creep.pos.roomName,
        x: clampRoomCoord(creep.pos.x + dx),
        y: clampRoomCoord(creep.pos.y + dy)
    };
}

function describeBlocker(blocker, step)
{
    var entry = {
        name: blocker.name,
        role: getRole(blocker),
        roomName: blocker.pos.roomName,
        x: blocker.pos.x,
        y: blocker.pos.y,
        fatigue: blocker.fatigue || 0
    };
    if (!blocker.my && blocker.owner && blocker.owner.username)
    {
        entry.owner = blocker.owner.username;
    }
    if (step && entry.roomName == step.roomName && entry.x == step.x && entry.y == step.y)
    {
        entry.onStep = true;
    }
    if (blocker.memory && blocker.memory.moveAsideForTraffic)
    {
        entry.yieldingForTraffic = true;
    }
    if (blocker.memory && blocker.memory.moveAsideForMiner)
    {
        entry.yieldingForMiner = true;
    }
    return entry;
}

function findAdjacentBlockers(creep, prev)
{
    if (!creep || !creep.room || !creep.room.lookForAtArea || typeof LOOK_CREEPS == 'undefined')
    {
        return [];
    }
    var step = getStepTowardDest(creep, prev);
    var top = clampRoomCoord(creep.pos.y - 1);
    var left = clampRoomCoord(creep.pos.x - 1);
    var bottom = clampRoomCoord(creep.pos.y + 1);
    var right = clampRoomCoord(creep.pos.x + 1);
    var found = creep.room.lookForAtArea(LOOK_CREEPS, top, left, bottom, right, true) || [];
    var blockers = [];
    var seen = {};
    for (var i = 0; i < found.length; i++)
    {
        var blocker = found[i].creep;
        if (!blocker || blocker.name == creep.name || seen[blocker.name])
        {
            continue;
        }
        seen[blocker.name] = true;
        blockers.push(describeBlocker(blocker, step));
    }
    blockers.sort(function(a, b) {
        if (a.onStep == true && b.onStep != true)
        {
            return -1;
        }
        if (b.onStep == true && a.onStep != true)
        {
            return 1;
        }
        if ((b.fatigue || 0) != (a.fatigue || 0))
        {
            return (b.fatigue || 0) - (a.fatigue || 0);
        }
        return a.name < b.name ? -1 : 1;
    });
    return blockers.slice(0, 4);
}

function blockerKey(blocker)
{
    return (blocker.role || 'unknown')
        + '@' + (blocker.roomName || 'unknown')
        + ':' + blocker.x
        + ':' + blocker.y;
}

function recordBlockerSamples(site, blockers)
{
    site.blockers = site.blockers || {};
    for (var i = 0; i < blockers.length; i++)
    {
        var blocker = blockers[i];
        var key = blockerKey(blocker);
        var entry = site.blockers[key] || {
            role: blocker.role,
            roomName: blocker.roomName,
            x: blocker.x,
            y: blocker.y,
            samples: 0
        };
        entry.name = blocker.name;
        entry.fatigue = blocker.fatigue || 0;
        entry.onStep = entry.onStep == true || blocker.onStep == true;
        entry.samples = (entry.samples || 0) + 1;
        entry.updated = Game.time;
        site.blockers[key] = entry;
    }
}

function capSiteBlockers(site)
{
    var keys = Object.keys(site.blockers || {});
    if (keys.length <= MAX_STUCK_SITE_BLOCKERS)
    {
        return;
    }
    keys.sort(function(a, b) {
        var ea = site.blockers[a];
        var eb = site.blockers[b];
        if ((ea.samples || 0) != (eb.samples || 0))
        {
            return (ea.samples || 0) - (eb.samples || 0);
        }
        return (ea.updated || 0) - (eb.updated || 0);
    });
    while (keys.length > MAX_STUCK_SITE_BLOCKERS)
    {
        delete site.blockers[keys.shift()];
    }
}

function rememberStuckSite(stats, creep, role, stuckTicks, prev, blockers)
{
    stats.stuckSites = stats.stuckSites || {};
    var key = creep.pos.roomName + ':' + creep.pos.x + ':' + creep.pos.y;
    var site = stats.stuckSites[key] || {
        roomName: creep.pos.roomName,
        x: creep.pos.x,
        y: creep.pos.y,
        samples: 0,
        roles: {},
        blockers: {},
        firstSeen: Game.time
    };
    site.samples = (site.samples || 0) + 1;
    site.maxStuckTicks = Math.max(site.maxStuckTicks || 0, stuckTicks);
    site.lastCreep = creep.name;
    site.lastRole = role;
    site.lastDest = prev ? prev.dest : undefined;
    site.updated = Game.time;
    site.lastBlockers = blockers;
    inc(site.roles, role);
    recordBlockerSamples(site, blockers);
    capSiteBlockers(site);
    stats.stuckSites[key] = site;
}

function rememberStuckCreep(stats, creep, role, stuckTicks, prev)
{
    if (stuckTicks < STUCK_REPORT_TICKS)
    {
        return;
    }
    var blockers = findAdjacentBlockers(creep, prev);
    var existing = stats.stuckCreeps[creep.name] || { samples: 0, firstSeen: Game.time };
    existing.role = role;
    existing.roomName = creep.pos.roomName;
    existing.x = creep.pos.x;
    existing.y = creep.pos.y;
    existing.fatigue = creep.fatigue || 0;
    existing.stuckTicks = stuckTicks;
    existing.maxStuckTicks = Math.max(existing.maxStuckTicks || 0, stuckTicks);
    existing.samples = (existing.samples || 0) + 1;
    existing.dest = prev ? prev.dest : undefined;
    existing.blockers = blockers;
    existing.updated = Game.time;
    stats.stuckCreeps[creep.name] = existing;
    rememberStuckSite(stats, creep, role, stuckTicks, prev, blockers);
}

function observeCreepBefore(creep)
{
    if (!isEnabled() || !creep || !creep.memory)
    {
        return;
    }

    var stats = ensureStats();
    var role = getRole(creep);
    var roleStats = getBucket(stats.roles, role);
    var roomStats = getBucket(stats.rooms, creep.pos.roomName);
    var prev = creep.memory._traffic;
    var prevWasLastTick = prev && prev.time == Game.time - 1;
    var samePosition = prevWasLastTick
        && prev.x == creep.pos.x
        && prev.y == creep.pos.y
        && prev.roomName == creep.pos.roomName;

    inc(stats, 'creepsSeen');
    inc(roleStats, 'ticks');
    inc(roomStats, 'ticks');

    if (creep.fatigue > 0)
    {
        inc(stats, 'fatigueTicks');
        inc(roleStats, 'fatigueTicks');
        inc(roomStats, 'fatigueTicks');
    }
    if (hasMoveIntentFromState(prev))
    {
        inc(stats, 'moveIntentTicks');
        inc(roleStats, 'moveIntentTicks');
        inc(roomStats, 'moveIntentTicks');
    }

    if (prevWasLastTick && !samePosition)
    {
        inc(stats, 'movedTicks');
        inc(roleStats, 'movedTicks');
        inc(roomStats, 'movedTicks');
        delete creep.memory._trafficStuckTicks;
    }
    else if (samePosition && hasMoveIntentFromState(prev) && creep.fatigue == 0)
    {
        creep.memory._trafficStuckTicks = (creep.memory._trafficStuckTicks || 0) + 1;
        inc(stats, 'stuckTicks');
        inc(roleStats, 'stuckTicks');
        inc(roomStats, 'stuckTicks');
        rememberStuckCreep(stats, creep, role, creep.memory._trafficStuckTicks, prev);
    }
    else if (!samePosition || creep.fatigue > 0 || !hasMoveIntentFromState(prev))
    {
        delete creep.memory._trafficStuckTicks;
    }

    if (creep.memory.moveAsideForMiner)
    {
        inc(stats, 'moveAsideRequestTicks');
        inc(roleStats, 'moveAsideRequestTicks');
        inc(roomStats, 'moveAsideRequestTicks');
    }

    if (creep.memory.moveAsideForTraffic)
    {
        inc(stats, 'trafficYieldRequestTicks');
        inc(roleStats, 'trafficYieldRequestTicks');
        inc(roomStats, 'trafficYieldRequestTicks');
    }

    if (!isHaulerRole(role) && isAtSpawnDropSpot(creep))
    {
        inc(stats, 'spawnDropBlockerTicks');
        inc(roleStats, 'spawnDropBlockerTicks');
        inc(roomStats, 'spawnDropBlockerTicks');
    }

    if (role == 'lorry'
        && creep.memory.lorryPickupId
        && (creep.memory.lorryPickupUntil == undefined || creep.memory.lorryPickupUntil >= Game.time))
    {
        var scratch = ensureScratch();
        scratch.lorryPickupCounts[creep.memory.lorryPickupId] = (scratch.lorryPickupCounts[creep.memory.lorryPickupId] || 0) + 1;
        inc(roleStats, 'lorryPickupReservationTicks');
    }

    if (role == 'remoteLorry'
        && creep.memory.home
        && creep.room.name != creep.memory.home)
    {
        inc(roleStats, 'remoteTravelTicks');
        inc(roomStats, 'remoteTravelTicks');
    }
    if (creep.memory.empty == true)
    {
        inc(roleStats, 'emptyTicks');
    }
    else if (creep.memory.empty == false)
    {
        inc(roleStats, 'loadedTicks');
    }
}

function observeCreepAfter(creep)
{
    if (!isEnabled() || !creep || !creep.memory)
    {
        return;
    }
    var state = creep.memory._traffic || {};
    state.time = Game.time;
    state.x = creep.pos.x;
    state.y = creep.pos.y;
    state.roomName = creep.pos.roomName;
    state.hadMoveIntent = hasMoveIntent(creep);
    var dest = getMoveDestKey(creep);
    if (dest)
    {
        state.dest = dest;
    }
    else
    {
        delete state.dest;
    }
    creep.memory._traffic = state;
}

function capStuckCreeps(stats)
{
    var names = Object.keys(stats.stuckCreeps || {});
    if (names.length <= MAX_STUCK_CREEPS)
    {
        return;
    }
    names.sort(function(a, b) {
        var ea = stats.stuckCreeps[a];
        var eb = stats.stuckCreeps[b];
        if ((ea.samples || 0) != (eb.samples || 0))
        {
            return (ea.samples || 0) - (eb.samples || 0);
        }
        if ((ea.maxStuckTicks || 0) != (eb.maxStuckTicks || 0))
        {
            return (ea.maxStuckTicks || 0) - (eb.maxStuckTicks || 0);
        }
        return (ea.updated || 0) - (eb.updated || 0);
    });
    while (names.length > MAX_STUCK_CREEPS)
    {
        delete stats.stuckCreeps[names.shift()];
    }
}

function capStuckSites(stats)
{
    var keys = Object.keys(stats.stuckSites || {});
    if (keys.length <= MAX_STUCK_SITES)
    {
        return;
    }
    keys.sort(function(a, b) {
        var ea = stats.stuckSites[a];
        var eb = stats.stuckSites[b];
        if ((ea.samples || 0) != (eb.samples || 0))
        {
            return (ea.samples || 0) - (eb.samples || 0);
        }
        if ((ea.maxStuckTicks || 0) != (eb.maxStuckTicks || 0))
        {
            return (ea.maxStuckTicks || 0) - (eb.maxStuckTicks || 0);
        }
        return (ea.updated || 0) - (eb.updated || 0);
    });
    while (keys.length > MAX_STUCK_SITES)
    {
        delete stats.stuckSites[keys.shift()];
    }
}

function endTick()
{
    if (!isEnabled())
    {
        return;
    }
    var stats = ensureStats();
    var scratch = ensureScratch();
    for (let targetId in scratch.lorryPickupCounts)
    {
        let count = scratch.lorryPickupCounts[targetId];
        if (count > 1)
        {
            inc(stats, 'duplicateLorryPickupTargetTicks');
            stats.lastDuplicateLorryPickups[targetId] = count;
        }
    }
    for (let name in stats.stuckCreeps)
    {
        if (!Game.creeps[name] || stats.stuckCreeps[name].updated < Game.time - 50)
        {
            delete stats.stuckCreeps[name];
        }
    }
    capStuckCreeps(stats);
    capStuckSites(stats);
    stats.updated = Game.time;
}

module.exports = {
    beginTick: beginTick,
    observeCreepBefore: observeCreepBefore,
    observeCreepAfter: observeCreepAfter,
    endTick: endTick,
    isEnabled: isEnabled
};
