var controllerLinkCacheTick;
var controllerLinksById = {};

function isBlockingStructure(structure)
{
    if (!structure)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_ROAD
        || structure.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_RAMPART)
    {
        return !structure.my && !structure.isPublic;
    }
    return true;
}

function isRoomCoord(x, y)
{
    return x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function isWalkablePosition(room, x, y)
{
    if (!room || !isRoomCoord(x, y))
    {
        return false;
    }
    var looks = room.lookAt(x, y);
    for (let look of looks)
    {
        if (look.type == LOOK_TERRAIN && look.terrain == 'wall')
        {
            return false;
        }
        if (look.type == LOOK_STRUCTURES && isBlockingStructure(look.structure))
        {
            return false;
        }
        if (look.type == LOOK_SOURCES || look.type == LOOK_MINERALS
            || (typeof LOOK_DEPOSITS != 'undefined' && look.type == LOOK_DEPOSITS))
        {
            return false;
        }
    }
    return true;
}

function getSharedSourceLinkSeats(source, link)
{
    var seats = [];
    if (!source || !link || !source.room || !link.room
        || source.room.name != link.room.name
        || link.structureType != STRUCTURE_LINK
        || !source.pos.inRangeTo(link, 2))
    {
        return seats;
    }

    for (let x = source.pos.x - 1; x <= source.pos.x + 1; x++)
    {
        for (let y = source.pos.y - 1; y <= source.pos.y + 1; y++)
        {
            if (x == source.pos.x && y == source.pos.y)
            {
                continue;
            }
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            let pos = new RoomPosition(x, y, source.room.name);
            if (!pos.inRangeTo(link, 1))
            {
                continue;
            }
            if (isWalkablePosition(source.room, x, y))
            {
                seats.push(pos);
            }
        }
    }
    return seats;
}

function hasSharedSourceLinkSeat(source, link)
{
    return getSharedSourceLinkSeats(source, link).length > 0;
}

function isUsableSourceLink(source, link)
{
    return !!(source && link
        && link.structureType == STRUCTURE_LINK
        && source.pos.inRangeTo(link, 2)
        && hasSharedSourceLinkSeat(source, link));
}

function findUsableSourceLinks(source)
{
    var sourceLinks = [];
    if (!source)
    {
        return sourceLinks;
    }
    var candidates = source.pos.findInRange(FIND_MY_STRUCTURES, 2,
    {
        filter: (s) => s.structureType == STRUCTURE_LINK
    });
    for (let link of candidates)
    {
        if (isUsableSourceLink(source, link))
        {
            sourceLinks.push(link);
        }
    }
    return sourceLinks;
}

function getSharedControllerLinkSeats(controller, link)
{
    var seats = [];
    if (!controller || !link || !controller.room || !link.room
        || controller.room.name != link.room.name
        || link.structureType != STRUCTURE_LINK
        || !controller.pos.inRangeTo(link, 4))
    {
        return seats;
    }

    for (let x = link.pos.x - 1; x <= link.pos.x + 1; x++)
    {
        for (let y = link.pos.y - 1; y <= link.pos.y + 1; y++)
        {
            if (x == link.pos.x && y == link.pos.y)
            {
                continue;
            }
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            let pos = new RoomPosition(x, y, link.room.name);
            if (!pos.inRangeTo(controller, 3))
            {
                continue;
            }
            if (isWalkablePosition(link.room, x, y))
            {
                seats.push(pos);
            }
        }
    }
    return seats;
}

function hasSharedControllerLinkSeat(controller, link)
{
    return getSharedControllerLinkSeats(controller, link).length > 0;
}

function isUsableControllerLink(controller, link)
{
    return !!(controller && link
        && link.structureType == STRUCTURE_LINK
        && controller.pos.inRangeTo(link, 4)
        && hasSharedControllerLinkSeat(controller, link));
}

function findUsableControllerLinks(controller)
{
    var controllerLinks = [];
    if (!controller || !controller.room)
    {
        return controllerLinks;
    }
    if (controllerLinkCacheTick != Game.time)
    {
        controllerLinkCacheTick = Game.time;
        controllerLinksById = {};
    }
    var cacheKey = controller.id || controller.room.name;
    if (controllerLinksById[cacheKey])
    {
        return controllerLinksById[cacheKey].slice();
    }
    var candidates = controller.pos.findInRange(FIND_MY_STRUCTURES, 4,
    {
        filter: (s) => s.structureType == STRUCTURE_LINK
    });
    for (let link of candidates)
    {
        if (isUsableControllerLink(controller, link))
        {
            controllerLinks.push(link);
        }
    }
    controllerLinksById[cacheKey] = controllerLinks;
    return controllerLinks.slice();
}

function isSharedSourceLinkSeat(pos, source, link)
{
    return !!(pos && source && link
        && pos.roomName == source.room.name
        && pos.inRangeTo(source, 1)
        && pos.inRangeTo(link, 1)
        && isWalkablePosition(source.room, pos.x, pos.y));
}

function findSharedSourceLinkSeat(creep, source, link)
{
    var seats = getSharedSourceLinkSeats(source, link);
    if (seats.length == 0)
    {
        return undefined;
    }
    if (creep && isSharedSourceLinkSeat(creep.pos, source, link))
    {
        return creep.pos;
    }

    var best = seats[0];
    var bestRange = creep ? creep.pos.getRangeTo(best) : 0;
    if (!creep)
    {
        return best;
    }
    for (let seat of seats)
    {
        let range = creep.pos.getRangeTo(seat);
        if (range < bestRange)
        {
            best = seat;
            bestRange = range;
        }
    }
    return best;
}

module.exports = {
    findUsableControllerLinks: findUsableControllerLinks,
    findSharedSourceLinkSeat: findSharedSourceLinkSeat,
    findUsableSourceLinks: findUsableSourceLinks,
    hasSharedControllerLinkSeat: hasSharedControllerLinkSeat,
    hasSharedSourceLinkSeat: hasSharedSourceLinkSeat,
    isSharedSourceLinkSeat: isSharedSourceLinkSeat,
    isUsableControllerLink: isUsableControllerLink,
    isUsableSourceLink: isUsableSourceLink
};
