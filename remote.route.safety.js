var remoteDanger = require('remote.danger');

function isRoomName(value)
{
    return typeof value == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(value);
}

function normalizeRooms(rawRooms)
{
    var rooms = [];
    if (rawRooms == undefined)
    {
        return rooms;
    }
    if (!Array.isArray(rawRooms))
    {
        rawRooms = [rawRooms];
    }
    for (let roomName of rawRooms)
    {
        if (isRoomName(roomName) && rooms.indexOf(roomName) < 0)
        {
            rooms.push(roomName);
        }
    }
    return rooms;
}

function getSafetyMemory()
{
    Memory.remoteBuildRouteSafety = Memory.remoteBuildRouteSafety || {};
    return Memory.remoteBuildRouteSafety;
}

function inspectRoom(roomName)
{
    var safetyMemory = getSafetyMemory();
    var room = Game.rooms ? Game.rooms[roomName] : undefined;
    var remembered = safetyMemory[roomName];
    if (room)
    {
        var attackingHostiles = remoteDanger.getAttackingHostileCount(room);
        remembered = {
            safe: attackingHostiles <= 0,
            attackingHostiles: attackingHostiles,
            lastSeen: Game.time
        };
        safetyMemory[roomName] = remembered;
    }
    else if (!remembered)
    {
        // Conditional route rooms are safe by default until an observer or a
        // mission creep actually sees a hostile with ATTACK/RANGED_ATTACK.
        remembered = {
            safe: true,
            attackingHostiles: 0
        };
        safetyMemory[roomName] = remembered;
    }

    return {
        safe: remembered.safe == true,
        attackingHostiles: remembered.attackingHostiles || 0,
        lastSeen: remembered.lastSeen,
        visible: !!room,
        assumedSafe: !room && remembered.lastSeen == undefined
    };
}

function observeRooms(homeRoom, rawRooms)
{
    var rooms = normalizeRooms(rawRooms);
    if (!homeRoom || rooms.length <= 0)
    {
        return undefined;
    }

    global.remoteBuildRouteObserverRuns = global.remoteBuildRouteObserverRuns || {};
    var existing = global.remoteBuildRouteObserverRuns[homeRoom.name];
    if (existing && existing.tick == Game.time)
    {
        return existing;
    }

    var observers = homeRoom.find(FIND_MY_STRUCTURES,
    {
        filter: function(structure)
        {
            return structure.structureType == STRUCTURE_OBSERVER;
        }
    });
    var observer = observers[0];
    var selectedRoom = rooms[Game.time % rooms.length];
    var result = observer ? observer.observeRoom(selectedRoom) : ERR_NOT_FOUND;
    var observation = {
        tick: Game.time,
        home: homeRoom.name,
        room: selectedRoom,
        observer: observer ? observer.id : undefined,
        result: result
    };
    global.remoteBuildRouteObserverRuns[homeRoom.name] = observation;
    Memory.remoteBuildRouteObserver = observation;
    return observation;
}

function evaluate(staticAvoidRooms, conditionalAvoidRooms)
{
    var activeAvoidRooms = normalizeRooms(staticAvoidRooms);
    var conditionalRooms = normalizeRooms(conditionalAvoidRooms);
    var roomSafety = {};
    for (let roomName of conditionalRooms)
    {
        let state = inspectRoom(roomName);
        roomSafety[roomName] = state;
        if (!state.safe && activeAvoidRooms.indexOf(roomName) < 0)
        {
            activeAvoidRooms.push(roomName);
        }
    }
    return {
        activeAvoidRooms: activeAvoidRooms,
        conditionalAvoidRooms: conditionalRooms,
        rooms: roomSafety
    };
}

module.exports = {
    normalizeRooms: normalizeRooms,
    inspectRoom: inspectRoom,
    observeRooms: observeRooms,
    evaluate: evaluate
};
