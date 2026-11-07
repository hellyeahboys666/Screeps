var ALLIES = ['MoMoCat'];

function getAvoidRooms(creep)
{
    if (creep.memory.avoidRooms != undefined)
    {
        if (Array.isArray(creep.memory.avoidRooms))
        {
            return creep.memory.avoidRooms;
        }
        return [creep.memory.avoidRooms];
    }

    return [];
}

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

function isAllyName(username)
{
    for (var i = 0; i < ALLIES.length; i++)
    {
        if (username == ALLIES[i])
        {
            return true;
        }
    }
    return false;
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

module.exports = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if (!creep.memory.target)
        {
            return;
        }
        if (!isValidRoomName(creep.memory.target))
        {
            creep.memory.targetError = 'invalid room ' + creep.memory.target;
            creep.say('bad room');
            return;
        }

        if (creep.room.name != creep.memory.target)
        {
            var avoidRooms = getAvoidRooms(creep);
            var route = Game.map.findRoute(creep.room.name, creep.memory.target,
            {
                routeCallback: function(roomName)
                {
                    if (avoidRooms.indexOf(roomName) >= 0)
                    {
                        return Infinity;
                    }
                    return 1;
                }
            });

            if (Array.isArray(route) && route.length > 0)
            {
                var exitType = route[0].exit;
                var exitDirection = getExitMoveDirection(exitType);
                if (exitDirection && isOnExitEdge(creep, exitType))
                {
                    creep.move(exitDirection);
                    return;
                }

                var exitPos = creep.pos.findClosestByRange(exitType);
                if (exitPos)
                {
                    if (exitDirection && exitPos.isEqualTo(creep.pos))
                    {
                        creep.move(exitDirection);
                        return;
                    }
                    creep.moveTo(exitPos, {reusePath: 20});
                }
            }
            else
            {
                if (avoidRooms.length > 0)
                {
                    creep.say('no route');
                    return;
                }
                var center = getRoomCenterPos(creep.memory.target);
                if (center)
                {
                    creep.moveTo(center, {reusePath: 20});
                }
            }
            return;
        }

        var controller = creep.room.controller;
        if (controller)
        {
            if (controller.my)
            {
                creep.say('claimed');
                creep.suicide();
                return;
            }
            if (controller.owner)
            {
                creep.say('owned');
                return;
            }

            if (controller.reservation
                && creep.owner
                && controller.reservation.username != creep.owner.username)
            {
                if (isAllyName(controller.reservation.username))
                {
                    creep.say('ally');
                    return;
                }
                var attackResult = creep.attackController(controller);
                if (attackResult == ERR_NOT_IN_RANGE)
                {
                    creep.moveTo(controller, {reusePath: 5});
                }
                else if (attackResult != OK)
                {
                    creep.say('atk ' + attackResult);
                }
                return;
            }

            var result = creep.claimController(controller);
            if(result == ERR_NOT_IN_RANGE)
            {
                creep.moveTo(controller, {reusePath: 5});
            }
            else if (result != OK)
            {
                creep.say('claim ' + result);
            }
        }
    }
};