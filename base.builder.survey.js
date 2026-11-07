// Read-only survey for raw Screeps modules. Never store a 2500-cell survey in Memory.
function validPos(pos, roomName) {
    return !!pos && Number.isInteger(pos.x) && Number.isInteger(pos.y)
        && pos.x >= 0 && pos.x < 50 && pos.y >= 0 && pos.y < 50
        && (!pos.roomName || pos.roomName === roomName);
}

function copyObjects(objects, roomName, isStructure) {
    if (!Array.isArray(objects)) return null;
    var result = [];
    for (var obj of objects) {
        if (!obj || !validPos(obj.pos, roomName)) return null;
        result.push({id: obj.id || null, type: isStructure ? obj.structureType : undefined,
            my: !!obj.my, pos: {x: obj.pos.x, y: obj.pos.y}});
    }
    result.sort(function(a, b) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : a.pos.y - b.pos.y || a.pos.x - b.pos.x;
    });
    return result;
}

function survey(room, options) {
    options = options || {};
    if (!room || !room.name || !room.controller || !room.controller.my) {
        return {eligible: false, reason: 'notOwned'};
    }
    if (typeof room.find !== 'function' || typeof room.getTerrain !== 'function') {
        return {eligible: false, reason: 'unavailableRoomAPI'};
    }
    var spawns = room.find(FIND_MY_SPAWNS);
    if (!Array.isArray(spawns)) return {eligible: false, reason: 'unavailableRoomAPI'};
    var owned = spawns.filter(function(s) {
        return s && s.my && s.structureType === STRUCTURE_SPAWN;
    });
    if (!owned.length && options.allowNoSpawn !== true) return {eligible: false, reason: 'noOwnedBuiltSpawn'};
    var snapshots = copyObjects(owned, room.name, true);
    var controller = room.controller;
    var structures = copyObjects(room.find(FIND_STRUCTURES), room.name, true);
    var sites = copyObjects(room.find(FIND_CONSTRUCTION_SITES), room.name, true);
    var sources = copyObjects(room.find(FIND_SOURCES), room.name, false);
    var minerals = copyObjects(room.find(FIND_MINERALS), room.name, false);
    if (!snapshots || !validPos(controller.pos, room.name)
        || !structures || !sites || !sources || !minerals) {
        return {eligible: false, reason: 'invalidRoomObjects'};
    }
    var terrain = room.getTerrain();
    if (!terrain || typeof terrain.get !== 'function') {
        return {eligible: false, reason: 'unavailableRoomAPI'};
    }
    var walls = new Array(2500);
    for (var y = 0; y < 50; y++) {
        for (var x = 0; x < 50; x++) {
            walls[y * 50 + x] = (terrain.get(x, y) & TERRAIN_MASK_WALL) ? 1 : 0;
        }
    }
    return {
        eligible: true,
        roomName: room.name,
        tick: typeof Game !== 'undefined' ? Game.time : undefined,
        level: controller.level,
        controller: {id: controller.id || null, pos: {x: controller.pos.x, y: controller.pos.y}},
        anchor: snapshots[0] || null, spawns: snapshots,
        structures: structures, sites: sites, sources: sources, minerals: minerals,
        terrain: walls
    };
}

module.exports = {survey: survey};
