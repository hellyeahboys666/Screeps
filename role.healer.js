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
            const route = Game.map.findRoute(creep.room.name, targetRoom);
            if (Array.isArray(route) && route.length > 0) 
            {
                const exitType = route[0].exit;
                const exitDirection = getExitMoveDirection(exitType);
                if (exitDirection && isOnExitEdge(creep, exitType))
                {
                    creep.move(exitDirection);
                    return;
                }

                const exit = creep.pos.findClosestByRange(exitType);
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