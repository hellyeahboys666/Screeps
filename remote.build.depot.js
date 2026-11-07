function isObject(value)
{
    return value != undefined && typeof value == 'object' && !Array.isArray(value);
}

function isRoomName(value)
{
    return typeof value == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(value);
}

function isFiniteNumber(value)
{
    return typeof value == 'number' && isFinite(value);
}

function normalizeDepotPos(raw, targetRoom)
{
    if (!isObject(raw))
    {
        return undefined;
    }

    var x = Math.floor(raw.x);
    var y = Math.floor(raw.y);
    var roomName = isRoomName(raw.roomName) ? raw.roomName : targetRoom;
    if (isRoomName(targetRoom) && roomName != targetRoom)
    {
        return undefined;
    }
    if (x >= 0 && x <= 49 && y >= 0 && y <= 49 && isRoomName(roomName))
    {
        return {
            x: x,
            y: y,
            roomName: roomName
        };
    }
    return undefined;
}

function isRedDepotFlag(flag, targetRoom)
{
    return flag
        && flag.color == COLOR_RED
        && flag.pos
        && flag.pos.roomName == targetRoom;
}

function flagToDepotPos(flag)
{
    return {
        x: flag.pos.x,
        y: flag.pos.y,
        roomName: flag.pos.roomName,
        flagName: flag.name
    };
}

function getRedDepotFlags(targetRoom)
{
    var flags = [];
    if (typeof Game == 'undefined' || !Game.flags)
    {
        return flags;
    }

    for (let name in Game.flags)
    {
        let flag = Game.flags[name];
        if (isRedDepotFlag(flag, targetRoom))
        {
            flags.push(flag);
        }
    }

    flags.sort(function(a, b)
    {
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return flags;
}

function flagNameContainsAll(flag, tokens)
{
    var name = (flag.name || '').toLowerCase();
    for (let token of tokens)
    {
        if (!token)
        {
            continue;
        }
        if (name.indexOf(String(token).toLowerCase()) < 0)
        {
            return false;
        }
    }
    return true;
}

function pickSingleByName(flags, tokens)
{
    var matches = [];
    for (let flag of flags)
    {
        if (flagNameContainsAll(flag, tokens))
        {
            matches.push(flag);
        }
    }
    return matches.length == 1 ? matches[0] : undefined;
}

function resolveRedDepotFlag(missionName, targetRoom, depotFlagName)
{
    if (!isRoomName(targetRoom))
    {
        return {flag: undefined, flagCount: 0, error: 'invalidTargetRoom'};
    }

    var flags = getRedDepotFlags(targetRoom);
    if (typeof depotFlagName == 'string' && depotFlagName.length > 0)
    {
        let namedFlag = typeof Game != 'undefined' && Game.flags ? Game.flags[depotFlagName] : undefined;
        if (isRedDepotFlag(namedFlag, targetRoom))
        {
            return {flag: namedFlag, flagCount: flags.length, error: undefined};
        }
        return {flag: undefined, flagCount: flags.length, error: 'missingDepotFlag:' + depotFlagName};
    }

    if (flags.length == 1)
    {
        return {flag: flags[0], flagCount: flags.length, error: undefined};
    }
    if (flags.length <= 0)
    {
        return {flag: undefined, flagCount: 0, error: undefined};
    }

    var flag = pickSingleByName(flags, ['depot', targetRoom])
        || pickSingleByName(flags, ['depot', missionName])
        || pickSingleByName(flags, ['depot'])
        || pickSingleByName(flags, [targetRoom]);
    if (flag)
    {
        return {flag: flag, flagCount: flags.length, error: undefined};
    }

    return {flag: undefined, flagCount: flags.length, error: 'ambiguousDepotFlags'};
}

function resolveDepotPosition(missionName, targetRoom, rawDepotPos, depotFlagName)
{
    var flagResult = resolveRedDepotFlag(missionName, targetRoom, depotFlagName);
    if (flagResult.flag)
    {
        return {
            pos: flagToDepotPos(flagResult.flag),
            source: 'redFlag',
            flagName: flagResult.flag.name,
            flagCount: flagResult.flagCount,
            error: undefined
        };
    }

    var memoryPos = normalizeDepotPos(rawDepotPos, targetRoom);
    if (memoryPos)
    {
        return {
            pos: memoryPos,
            source: 'memory',
            flagName: undefined,
            flagCount: flagResult.flagCount,
            error: undefined
        };
    }

    return {
        pos: undefined,
        source: flagResult.error ? 'redFlag' : 'missing',
        flagName: depotFlagName,
        flagCount: flagResult.flagCount,
        error: flagResult.error || 'missingDepotPos'
    };
}

function getDepotFlagName(data)
{
    if (!isObject(data))
    {
        return undefined;
    }
    if (typeof data.depotFlag == 'string')
    {
        return data.depotFlag;
    }
    if (typeof data.depotFlagName == 'string')
    {
        return data.depotFlagName;
    }
    return undefined;
}

function getMissionTarget(key, raw, fallback)
{
    if (isObject(raw))
    {
        if (isRoomName(raw.target))
        {
            return raw.target;
        }
        if (isRoomName(raw.targetRoom))
        {
            return raw.targetRoom;
        }
    }
    if (isRoomName(key))
    {
        return key;
    }
    return isRoomName(fallback) ? fallback : undefined;
}

function findMissionConfig(missionName, targetRoom)
{
    var missions = typeof Memory != 'undefined' ? Memory.remoteBuildMissions : undefined;
    if (!missions)
    {
        return undefined;
    }

    function matches(key, raw)
    {
        if (raw == false)
        {
            return false;
        }
        var data = isObject(raw) ? raw : {};
        if (data.active == false)
        {
            return false;
        }
        var rawTarget = getMissionTarget(key, data, targetRoom);
        var nameMatches = missionName && (key == missionName || data.name == missionName);
        var targetMatches = targetRoom && rawTarget == targetRoom;
        return nameMatches ? (!targetRoom || targetMatches) : targetMatches;
    }

    if (Array.isArray(missions))
    {
        for (var i = 0; i < missions.length; i++)
        {
            let raw = missions[i];
            let data = isObject(raw) ? raw : {};
            let key = data.name ? data.name : String(i);
            if (matches(key, raw))
            {
                return {key: key, raw: data, target: getMissionTarget(key, data, targetRoom)};
            }
        }
        return undefined;
    }

    for (let key in missions)
    {
        let raw = missions[key];
        let data = isObject(raw) ? raw : {};
        if (matches(key, raw))
        {
            return {key: key, raw: data, target: getMissionTarget(key, data, targetRoom)};
        }
    }
    return undefined;
}

function resolveCreepDepotPosition(creep)
{
    if (!creep || !creep.memory)
    {
        return {
            pos: undefined,
            source: 'missing',
            flagName: undefined,
            flagCount: 0,
            error: 'missingCreepMemory'
        };
    }

    var missionName = creep.memory.remoteBuildMission || creep.memory.mission || creep.memory.missionName;
    var targetRoom = creep.memory.target;
    var mission = findMissionConfig(missionName, targetRoom);
    if (mission)
    {
        return resolveDepotPosition(mission.raw.name || mission.key || missionName || mission.target,
            mission.target || targetRoom,
            mission.raw.depotPos,
            getDepotFlagName(mission.raw));
    }

    return resolveDepotPosition(missionName,
        targetRoom,
        creep.memory.depotPos,
        creep.memory.depotFlag);
}

function resolveRoomDepotPosition(roomName)
{
    var mission = findMissionConfig(undefined, roomName);
    if (!mission)
    {
        return undefined;
    }
    var depot = resolveDepotPosition(mission.raw.name || mission.key || mission.target,
        mission.target || roomName,
        mission.raw.depotPos,
        getDepotFlagName(mission.raw));
    return depot.pos;
}

function isNearDepotPos(pos, depotPos, range)
{
    if (!pos || !depotPos || pos.roomName != depotPos.roomName)
    {
        return false;
    }
    range = range == undefined ? 1 : range;
    return Math.max(Math.abs(pos.x - depotPos.x), Math.abs(pos.y - depotPos.y)) <= range;
}

function isRemoteBuildDepotPos(pos, range)
{
    if (!pos || !isRoomName(pos.roomName))
    {
        return false;
    }
    return isNearDepotPos(pos, resolveRoomDepotPosition(pos.roomName), range);
}

function getFlaggedDepotStorage(depotPos)
{
    if (!depotPos || !depotPos.lookFor)
    {
        return undefined;
    }

    var structures = depotPos.lookFor(LOOK_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_STORAGE)
        {
            return structure;
        }
    }
    return undefined;
}

function roomHasOwnedSpawn(room)
{
    return room && room.find(FIND_MY_SPAWNS).length > 0;
}

function isRemoteBuildDepotEnergyStructure(structure)
{
    if (!structure || !structure.pos)
    {
        return false;
    }
    if (structure.structureType != STRUCTURE_CONTAINER
        && structure.structureType != STRUCTURE_STORAGE)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_STORAGE && roomHasOwnedSpawn(structure.room))
    {
        // Once the target room has its own spawn, the storage is the local base
        // bank even if the old remote-build red depot flag still sits on it.
        return false;
    }
    return isRemoteBuildDepotPos(structure.pos, 1);
}

function isRemoteBuildDepotDroppedEnergy(resource)
{
    return resource
        && resource.resourceType == RESOURCE_ENERGY
        && resource.pos
        && isRemoteBuildDepotPos(resource.pos, 1);
}

module.exports = {
    isRedDepotFlag: isRedDepotFlag,
    normalizeDepotPos: normalizeDepotPos,
    resolveDepotPosition: resolveDepotPosition,
    resolveCreepDepotPosition: resolveCreepDepotPosition,
    resolveRoomDepotPosition: resolveRoomDepotPosition,
    isRemoteBuildDepotPos: isRemoteBuildDepotPos,
    getFlaggedDepotStorage: getFlaggedDepotStorage,
    isRemoteBuildDepotEnergyStructure: isRemoteBuildDepotEnergyStructure,
    isRemoteBuildDepotDroppedEnergy: isRemoteBuildDepotDroppedEnergy
};
