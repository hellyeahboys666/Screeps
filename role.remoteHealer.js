function isValidRoomName(roomName)
{
    return typeof roomName == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(roomName);
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

function moveToRoom(creep, roomName)
{
    if (!isValidRoomName(roomName))
    {
        return;
    }
    var exit = creep.room.findExitTo(roomName);
    if (exit > 0)
    {
        var exitDirection = getExitMoveDirection(exit);
        if (exitDirection && isOnExitEdge(creep, exit))
        {
            creep.move(exitDirection);
            return;
        }
        var exitPos = creep.pos.findClosestByRange(exit);
        if (exitPos)
        {
            if (exitDirection && exitPos.isEqualTo(creep.pos))
            {
                creep.move(exitDirection);
                return;
            }
            creep.moveTo(exitPos);
        }
    }
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
    run: function(creep) {
        var targetRoom = creep.memory.target;
        if (!targetRoom)
        {
            return;
        }
        if (!isValidRoomName(targetRoom))
        {
            creep.memory.targetError = 'invalid room ' + targetRoom;
            return;
        }
        var flag = creep.room.find(FIND_FLAGS, 
        {
            filter: (f) => f.color == COLOR_PURPLE
        })[0];
        if (creep.room.name != targetRoom)
        {
            // Rally once; re-checking the flag after leaving it makes the
            // healer oscillate between the flag and the exit.
            if (flag && !creep.memory.rallied)
            {
                if (!creep.pos.inRangeTo(flag, 1))
                {
                    creep.moveTo(flag);
                    return;
                }
                creep.memory.rallied = true;
            }
            moveToRoom(creep, creep.memory.target);
            return;
        }
        else
        {
            var friendly = creep.pos.findClosestByPath(FIND_MY_CREEPS,
            {
                filter: (c) => (c.memory.role == 'attacker' || c.memory.role == 'defender')
                    && c.hits < c.hitsMax
            });
            if (friendly == undefined)
            {
                friendly = creep.pos.findClosestByPath(FIND_MY_CREEPS,
                {
                    filter: (c) => c.memory.role == 'attacker' || c.memory.role == 'defender'
                });
            }
            if (friendly == undefined && creep.hits < creep.hitsMax)
            {
                friendly = creep;
            }
            if (friendly == undefined
                && (creep.pos.x == 0 || creep.pos.x == 49 || creep.pos.y == 0 || creep.pos.y == 49))
            {
                // Idling on the exit tile would bounce the healer out of the room.
                creep.moveTo(new RoomPosition(25, 25, targetRoom), {range: 20});
                return;
            }
            healOrMoveTo(creep, friendly);
        }
    }
};