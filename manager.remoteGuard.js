'use strict';
// Guards for rooms where our remote creeps work (remote harvesting, reserving,
// remote building, carrying): when Invader creeps show up there, send enough
// RANGED_ATTACK + HEAL guards from the nearest strong room to kill them, then let
// the guards escort the workers for a while before going home.
//
// Settings: Memory.remoteGuard = {enabled: true, includePlayers: false, maxGuards: 4}
// Status per room: Memory.remoteGuardRooms[room] = {threat, needed, verdict, ...}

var combatMath = require('combat.math');

var DEFAULTS = {enabled: true, includePlayers: false, maxGuards: 4};
var REMOTE_ROLES = {longDistanceHarvester: true, remoteLorry: true, reserver: true, remoteBuilder: true,
    remoteCarrier: true, claimer: true, remoteHealer: true, looter: true};
var THREAT_MEMORY_TICKS = 1500;   // NPC invaders live 1500 ticks; forget an unseen threat after that
var KILL_TICKS = 100;             // guards should out-damage enemy heal and kill them within this
var DAMAGE_MARGIN = 1.3;
var MAX_HOME_DISTANCE = 3;
var MIN_HOME_CAPACITY = 1300;
// Guard body: 3 x (RANGED_ATTACK + MOVE) + 1 x (HEAL + MOVE) per 900-energy block, 6 blocks max.
var BLOCK = {cost: 900, ranged: 3, heal: 1};
var MAX_BLOCKS = 6;
var SKIP_OWNERS = {'Source Keeper': true, MoMoCat: true};

function config()
{
    var raw = Memory.remoteGuard, cfg = Object.assign({}, DEFAULTS);
    if (raw === false) cfg.enabled = false;
    else if (raw && typeof raw == 'object')
    {
        if (typeof raw.enabled == 'boolean') cfg.enabled = raw.enabled;
        if (typeof raw.includePlayers == 'boolean') cfg.includePlayers = raw.includePlayers;
        if (Number.isInteger(raw.maxGuards)) cfg.maxGuards = Math.max(1, Math.min(8, raw.maxGuards));
    }
    return cfg;
}

function isRoomName(name)
{
    return typeof name == 'string' && /^[WE]\d+[NS]\d+$/.test(name);
}

// Source keeper rooms and the sector centre have their own dangers; guards stay out.
function isKeeperRoom(name)
{
    var m = /^[WE](\d+)[NS](\d+)$/.exec(name || '');
    if (!m) return false;
    var x = Number(m[1]) % 10, y = Number(m[2]) % 10;
    return x >= 4 && x <= 6 && y >= 4 && y <= 6;
}

function isOwnedByUs(name)
{
    var room = Game.rooms[name];
    return !!(room && room.controller && room.controller.my);
}

var cache = {tick: -1};
function tickCache()
{
    if (cache.tick !== Game.time) cache = {tick: Game.time};
    return cache;
}

// Rooms our remote creeps are in or are working toward.
function protectedRooms()
{
    var c = tickCache();
    if (c.protectedRooms) return c.protectedRooms;
    var rooms = {};
    var add = function(name) {
        if (isRoomName(name) && !isOwnedByUs(name) && !isKeeperRoom(name)) rooms[name] = true;
    };
    for (var name in Game.creeps)
    {
        var creep = Game.creeps[name], mem = creep.memory || {};
        if (!REMOTE_ROLES[mem.role]) continue;
        if (creep.room) add(creep.room.name);
        add(mem.target); add(mem.targetRoom); add(mem.remoteRoom);
    }
    for (var spawnName in Game.spawns)
    {
        var rooms_ = Game.spawns[spawnName].memory && Game.spawns[spawnName].memory.reserveRooms;
        if (Array.isArray(rooms_)) rooms_.forEach(add);
    }
    c.protectedRooms = Object.keys(rooms).sort();
    return c.protectedRooms;
}

function isThreat(creep, cfg)
{
    var owner = creep.owner && creep.owner.username;
    if (!owner || SKIP_OWNERS[owner]) return false;
    if (owner != 'Invader' && !cfg.includePlayers) return false;
    return creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0
        || creep.getActiveBodyparts(HEAL) > 0 || creep.getActiveBodyparts(WORK) > 0;
}

// Effective hits: TOUGH boosts make a creep take less damage per hit point.
function effectiveHits(creep)
{
    var raw = 1000, after = combatMath.damageAfterTough(creep, raw);
    var factor = after > 0 ? raw / after : 1;
    return Math.ceil(creep.hits * Math.max(1, Math.min(factor, 3.33)));
}

function measure(hostiles)
{
    var t = {count: hostiles.length, damage: 0, heal: 0, hits: 0, boosted: false};
    for (var h of hostiles)
    {
        t.damage += combatMath.attackPower(h) + combatMath.rangedAttackPower(h);
        t.heal += combatMath.directHealPower(h);
        t.hits += effectiveHits(h);
        if ((h.body || []).some(function(p) { return p && p.boost; })) t.boosted = true;
    }
    return t;
}

// boost: 1 unboosted, 4 with XKHO2 + XLHO2 (T3 ranged attack and heal).
function guardStats(capacity, boost)
{
    var m = boost || 1;
    var blocks = Math.max(0, Math.min(MAX_BLOCKS, Math.floor(capacity / BLOCK.cost)));
    var ranged = blocks * BLOCK.ranged, heal = blocks * BLOCK.heal;
    return {blocks: blocks, dps: ranged * 10 * m, heal: heal * 12 * m, hits: blocks * 8 * 100,
        cost: blocks * BLOCK.cost, rangedParts: ranged, healParts: heal};
}

// T3 boosts for n guards in the home room's storage and terminal.
function hasGuardBoosts(room, guard, n)
{
    var stock = function(type) {
        return (room.storage && room.storage.store[type] || 0) + (room.terminal && room.terminal.store[type] || 0);
    };
    return stock('XKHO2') >= 30 * guard.rangedParts * n && stock('XLHO2') >= 30 * guard.healParts * n;
}

// How many guards of this size beat the threat? Pure. 0 = nothing to do,
// Infinity = cannot be won with maxGuards.
function guardsNeeded(threat, guard, maxGuards)
{
    if (!threat || !threat.count) return 0;
    if (!guard || !guard.blocks) return Infinity;
    for (var n = 1; n <= maxGuards; n++)
    {
        var dps = n * guard.dps;
        var outDamage = dps >= DAMAGE_MARGIN * threat.heal + threat.hits / KILL_TICKS;
        // Kiting guards take part of the damage; their heal plus a share of their hit
        // points must cover it for the fight's length.
        var fightTicks = Math.max(1, threat.hits / Math.max(1, dps - threat.heal));
        var survive = n * guard.heal + (n * guard.hits * 0.5) / fightTicks >= 0.6 * threat.damage;
        if (outDamage && survive) return n;
    }
    return Infinity;
}

function homeFor(roomName)
{
    var best = null, bestDistance = Infinity;
    for (var name in Game.rooms)
    {
        var room = Game.rooms[name];
        if (!room.controller || !room.controller.my || room.energyCapacityAvailable < MIN_HOME_CAPACITY) continue;
        if (!room.find(FIND_MY_SPAWNS).length) continue;
        var d = Game.map.getRoomLinearDistance(name, roomName);
        if (d > MAX_HOME_DISTANCE) continue;
        if (d < bestDistance || (d == bestDistance && room.energyCapacityAvailable > Game.rooms[best].energyCapacityAvailable))
        {
            best = name; bestDistance = d;
        }
    }
    return best;
}

function guardsFor(roomName)
{
    var n = 0;
    for (var name in Game.creeps)
    {
        var mem = Game.creeps[name].memory;
        if (mem && mem.role == 'remoteGuard' && mem.target == roomName) n++;
    }
    return n;
}

function run()
{
    if (typeof Game == 'undefined') return;
    var cfg = config();
    var records = Memory.remoteGuardRooms = Memory.remoteGuardRooms || {};
    var rooms = protectedRooms();
    for (var name of rooms)
    {
        var room = Game.rooms[name];
        if (!room) continue;
        var hostiles = room.find(FIND_HOSTILE_CREEPS, {filter: function(c) { return isThreat(c, cfg); }});
        if (!hostiles.length)
        {
            if (records[name] && records[name].threat) { records[name].clearedAt = Game.time; delete records[name].threat; }
            continue;
        }
        var record = records[name] = records[name] || {};
        record.threat = measure(hostiles);
        record.seen = Game.time;
        var home = homeFor(name);
        record.home = home;
        var capacity = home ? Game.rooms[home].energyCapacityAvailable : 0;
        var needed = guardsNeeded(record.threat, guardStats(capacity, 1), cfg.maxGuards);
        record.boosted = false;
        if (needed === Infinity && home)
        {
            // Unboosted guards would lose: boosted ones may win, if the home has the boosts.
            var boostedNeed = guardsNeeded(record.threat, guardStats(capacity, 4), cfg.maxGuards);
            if (boostedNeed !== Infinity && hasGuardBoosts(Game.rooms[home], guardStats(capacity, 4), boostedNeed))
            {
                needed = boostedNeed;
                record.boosted = true;
            }
        }
        record.needed = needed === Infinity ? 0 : needed;
        record.verdict = !home ? 'noHome' : needed === Infinity ? 'tooStrong' : 'defend';
    }
    for (var roomName in records)
    {
        var r = records[roomName];
        var stale = r.threat && Game.time - (r.seen || 0) > THREAT_MEMORY_TICKS;
        var settled = !r.threat && Game.time - (r.clearedAt || 0) > THREAT_MEMORY_TICKS;
        if (stale || settled || rooms.indexOf(roomName) < 0 && !r.threat) delete records[roomName];
    }
}

// The guard this spawn should make now, if any: the room it is home for that is
// most short of guards.
function getSpawnRequest(spawn)
{
    var cfg = config();
    var records = Memory.remoteGuardRooms;
    if (!cfg.enabled || !records) return undefined;
    var best = null;
    for (var roomName in records)
    {
        var r = records[roomName];
        if (!r.threat || r.verdict != 'defend' || r.home != spawn.room.name) continue;
        var missing = r.needed - guardsFor(roomName);
        if (missing > 0 && (!best || missing > best.missing)) best = {room: roomName, missing: missing};
    }
    if (!best) return undefined;
    var guard = guardStats(spawn.room.energyCapacityAvailable, 1);
    return {room: best.room, blocks: guard.blocks, cost: guard.cost, boosted: records[best.room].boosted === true};
}

// Where an idle guard should go: a threatened room still short of guards.
function reassignment(fromRoom)
{
    var records = Memory.remoteGuardRooms || {};
    for (var roomName in records)
    {
        var r = records[roomName];
        if (roomName != fromRoom && r.threat && r.verdict == 'defend' && guardsFor(roomName) < r.needed) return roomName;
    }
    return undefined;
}

module.exports = {
    run: run,
    getSpawnRequest: getSpawnRequest,
    reassignment: reassignment,
    isThreat: isThreat,
    config: config,
    // exported for tests
    guardsNeeded: guardsNeeded,
    guardStats: guardStats,
    measure: measure,
    protectedRooms: protectedRooms,
    isKeeperRoom: isKeeperRoom,
    BLOCK: BLOCK
};
