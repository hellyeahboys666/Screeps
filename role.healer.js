function isValidRoomName(roomName)
{
    return typeof roomName == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(roomName);
}

function getRoomCenterPos(roomName)
{
    if (!isValidRoomName(roomName))
    {
        return undefined;
    }
    return new RoomPosition(25, 25, roomName);
}

function getExitMoveDirection(exit)
{
    if (exit == FIND_EXIT_TOP)
    {
        return TOP;
    }
    if (exit == FIND_EXIT_RIGHT)
    {
        return RIGHT;
    }
    if (exit == FIND_EXIT_BOTTOM)
    {
        return BOTTOM;
    }
    if (exit == FIND_EXIT_LEFT)
    {
        return LEFT;
    }
    return undefined;
}

function isOnExitEdge(creep, exit)
{
    return (exit == FIND_EXIT_TOP && creep.pos.y == 0)
        || (exit == FIND_EXIT_RIGHT && creep.pos.x == 49)
        || (exit == FIND_EXIT_BOTTOM && creep.pos.y == 49)
        || (exit == FIND_EXIT_LEFT && creep.pos.x == 0);
}

// Route and exit tile change only when the creep changes room, so look them up
// once per room visit instead of every tick; by path so an exit segment walled
// off from the creep is never picked.
function getTravelExit(creep, targetRoom)
{
    var travel = creep.memory.travelExit;
    if (travel && travel.room == creep.room.name && travel.target == targetRoom
        && travel.time >= Game.time - 1)
    {
        travel.time = Game.time;
        return travel;
    }
    travel = {room: creep.room.name, target: targetRoom, time: Game.time};
    var route;
    if (creep.memory.avoidRooms != undefined)
    {
        var avoidRooms = Array.isArray(creep.memory.avoidRooms) ? creep.memory.avoidRooms : [creep.memory.avoidRooms];
        route = Game.map.findRoute(creep.room.name, targetRoom,
        {
            routeCallback: function(roomName)
            {
                return avoidRooms.indexOf(roomName) >= 0 ? Infinity : 1;
            }
        });
    }
    else
    {
        route = Game.map.findRoute(creep.room.name, targetRoom);
    }
    if (Array.isArray(route) && route.length > 0)
    {
        travel.exit = route[0].exit;
        var exitPos = creep.pos.findClosestByPath(travel.exit)
            || creep.pos.findClosestByRange(travel.exit);
        if (exitPos)
        {
            travel.x = exitPos.x;
            travel.y = exitPos.y;
        }
    }
    creep.memory.travelExit = travel;
    return travel;
}

function isCombatSupportTarget(creep)
{
    return creep && creep.memory
        && (creep.memory.role == 'attacker'
            || creep.memory.role == 'defender'
            || creep.memory.role == 'quad'
            || creep.memory.role == 'remoteHealer');
}

function getRecentTowerHealTarget(creep)
{
    var towerDefense = creep.room.memory ? creep.room.memory.towerDefense : undefined;
    if (!towerDefense || !towerDefense.healTarget || towerDefense.tick < Game.time - 1)
    {
        return undefined;
    }
    var target = Game.creeps[towerDefense.healTarget];
    if (!target || target.room.name != creep.room.name || target.hits >= target.hitsMax)
    {
        return undefined;
    }
    return target;
}

function healOrMoveTo(creep, target)
{
    if (!target)
    {
        return;
    }
    if (creep.pos.isNearTo(target))
    {
        creep.heal(target);
        return;
    }
    if (creep.pos.inRangeTo(target, 3))
    {
        creep.rangedHeal(target);
    }
    creep.moveTo(target, {range: 1, reusePath: 3});
}

module.exports = {
    run: function(creep){
        var targetRoom = creep.memory.target;
        if (targetRoom && !isValidRoomName(targetRoom))
        {
            creep.memory.targetError = 'invalid room ' + targetRoom;
            return;
        }
        if (targetRoom && creep.room.name != targetRoom)
        {
            // heal runs alongside move, so keep healing while travelling.
            var hurt = creep.hits < creep.hitsMax ? creep
                : creep.pos.findInRange(FIND_MY_CREEPS, 1, {filter: (c) => c.hits < c.hitsMax})[0];
            if (hurt)
            {
                creep.heal(hurt);
            }
            const travel = getTravelExit(creep, targetRoom);
            if (travel.exit != undefined)
            {
                const exitType = travel.exit;
                const exitDirection = getExitMoveDirection(exitType);
                if (exitDirection && isOnExitEdge(creep, exitType))
                {
                    creep.move(exitDirection);
                    return;
                }

                const exit = travel.x != undefined ? new RoomPosition(travel.x, travel.y, creep.room.name) : undefined;
                if (exit)
                {
                    if (exitDirection && exit.isEqualTo(creep.pos))
                    {
                        creep.move(exitDirection);
                        return;
                    }
                    creep.moveTo(exit);
                    return;
                }
            }
            var center = getRoomCenterPos(targetRoom);
            if (center)
            {
                creep.moveTo(center);
            }
            return;
        }

        var towerHealTarget = getRecentTowerHealTarget(creep);
        if (towerHealTarget)
        {
            healOrMoveTo(creep, towerHealTarget);
            return;
        }

        var friendly = creep.pos.findClosestByPath(FIND_MY_CREEPS,
        {
            filter: (c) => isCombatSupportTarget(c) && c.hits < c.hitsMax
        });
        if (!friendly && creep.hits < creep.hitsMax)
        {
            friendly = creep;
        }
        if (friendly == undefined)
        {
            friendly = creep.pos.findClosestByPath(FIND_MY_CREEPS,
            {
                filter: isCombatSupportTarget
            });
        }
        if (friendly == undefined)
        {
            friendly = creep.pos.findClosestByPath(FIND_MY_CREEPS,
            {
                filter: (c) => c.hits < c.hitsMax
            });
        }
        healOrMoveTo(creep, friendly);
    }
};