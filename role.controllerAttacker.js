/*
 * Controller attacker / downgrader.
 *
 * This is the hostile counterpart to role.claimer. It travels to targetRoom and
 * repeatedly calls attackController() so a reserved controller loses its
 * reservation, or an owned controller is pushed toward downgrade/neutral.
 *
 * Supported memory:
 *   target / targetRoom  - room whose controller should be attacked
 *   avoidRooms           - array/string of rooms to avoid while routing
 *   suicideWhenDone      - set false to keep creep alive after controller is neutral
 */

var ALLIES = ['MoMoCat'];

function getTargetRoom(creep)
{
    return creep.memory.targetRoom || creep.memory.target || creep.memory.attackControllerRoom;
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

function getAvoidRooms(creep, targetRoom)
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

function moveToRoom(creep, targetRoom)
{
    if (!isValidRoomName(targetRoom))
    {
        creep.memory.targetRoomError = 'invalid room ' + targetRoom;
        return;
    }
    var avoidRooms = getAvoidRooms(creep, targetRoom);
    var route = Game.map.findRoute(creep.room.name, targetRoom,
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
            return;
        }
    }

    if (avoidRooms.length > 0)
    {
        creep.say('no route');
        return;
    }
    var center = getRoomCenterPos(targetRoom);
    if (center)
    {
        creep.moveTo(center, {reusePath: 20});
    }
}

function controllerIsNeutral(controller)
{
    return controller && !controller.owner && !controller.reservation;
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

function controllerIsAllied(controller)
{
    return (controller.owner && isAllyName(controller.owner.username))
        || (controller.reservation && isAllyName(controller.reservation.username));
}

module.exports = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var targetRoom = getTargetRoom(creep);
        if (!targetRoom)
        {
            creep.say('no target');
            return;
        }
        if (!isValidRoomName(targetRoom))
        {
            creep.memory.targetRoomError = 'invalid room ' + targetRoom;
            creep.say('bad room');
            return;
        }

        if (creep.room.name != targetRoom)
        {
            moveToRoom(creep, targetRoom);
            return;
        }

        var controller = creep.room.controller;
        if (!controller)
        {
            return;
        }

        if (controllerIsNeutral(controller))
        {
            creep.say('neutral');
            if (creep.memory.suicideWhenDone !== false)
            {
                creep.suicide();
            }
            return;
        }

        if (controllerIsAllied(controller))
        {
            creep.say('ally');
            return;
        }

        var result = creep.attackController(controller);
        if (result == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(controller, {reusePath: 5});
        }
        else if (result == ERR_TIRED)
        {
            creep.say('tired');
        }
        else if (result == OK)
        {
            if (controller.reservation)
            {
                creep.say('res ' + controller.reservation.ticksToEnd);
            }
            else if (controller.owner)
            {
                creep.say('down');
            }
        }
        else if (result == ERR_INVALID_TARGET && controllerIsNeutral(controller))
        {
            creep.say('neutral');
        }
        else
        {
            creep.say('ctrl ' + result);
        }
    }
};