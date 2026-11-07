var combatMath = require('combat.math');

var roleDefender = {

    /** @param {Creep} creep **/
    run: function(creep) {
        function isHostile(c)
        {
            return c.owner && c.owner.username != 'MoMoCat';
        }

        function isDangerous(c)
        {
            return c.getActiveBodyparts(ATTACK) > 0
                || c.getActiveBodyparts(RANGED_ATTACK) > 0
                || c.getActiveBodyparts(HEAL) > 0
                || c.getActiveBodyparts(WORK) > 0;
        }

        function isHostileStructure(s)
        {
            if (!s || s.my)
            {
                return false;
            }
            return !(s.owner && s.owner.username == 'MoMoCat');
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

        function closestHostile(filter)
        {
            return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS,
            {
                filter: filter
            }) || creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,
            {
                filter: filter
            });
        }

        function getRecentTowerFocusTarget()
        {
            var towerDefense = creep.room.memory ? creep.room.memory.towerDefense : undefined;
            if (!towerDefense || !towerDefense.attackTarget || towerDefense.tick < Game.time - 1)
            {
                return undefined;
            }
            var target = Game.getObjectById(towerDefense.attackTarget);
            if (!target || !target.pos || target.pos.roomName != creep.room.name || !isHostile(target))
            {
                return undefined;
            }
            return target;
        }

        function rememberDefenseTarget(target)
        {
            if (!target || !target.id)
            {
                delete creep.memory.defenseTarget;
                delete creep.memory.defenseTargetTick;
                return;
            }
            creep.memory.defenseTarget = target.id;
            creep.memory.defenseTargetTick = Game.time;
        }

        function clearDefenseTarget()
        {
            delete creep.memory.defenseTarget;
            delete creep.memory.defenseTargetTick;
        }

        function hasOwnedRampart(pos)
        {
            var structures = pos.lookFor(LOOK_STRUCTURES);
            for (var i=0; i<structures.length; i++)
            {
                if (structures[i].structureType == STRUCTURE_RAMPART && structures[i].my)
                {
                    return true;
                }
            }
            return false;
        }

        function isWalkable(pos)
        {
            if (Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) == TERRAIN_MASK_WALL)
            {
                return false;
            }
            var structures = pos.lookFor(LOOK_STRUCTURES);
            for (var i=0; i<structures.length; i++)
            {
                var structure = structures[i];
                if (structure.structureType == STRUCTURE_ROAD
                    || structure.structureType == STRUCTURE_CONTAINER
                    || (structure.structureType == STRUCTURE_RAMPART && structure.my))
                {
                    continue;
                }
                return false;
            }
            return pos.lookFor(LOOK_CREEPS).length == 0;
        }

        function moveAwayFrom(target)
        {
            var bestPos = undefined;
            var bestRange = creep.pos.getRangeTo(target);
            for (var dx=-1; dx<=1; dx++)
            {
                for (var dy=-1; dy<=1; dy++)
                {
                    if (dx == 0 && dy == 0)
                    {
                        continue;
                    }
                    var x = creep.pos.x + dx;
                    var y = creep.pos.y + dy;
                    if (x <= 0 || x >= 49 || y <= 0 || y >= 49)
                    {
                        continue;
                    }
                    var pos = new RoomPosition(x, y, creep.room.name);
                    if (!isWalkable(pos))
                    {
                        continue;
                    }
                    var range = pos.getRangeTo(target);
                    if (range > bestRange)
                    {
                        bestRange = range;
                        bestPos = pos;
                    }
                }
            }
            if (bestPos)
            {
                creep.move(creep.pos.getDirectionTo(bestPos));
                return true;
            }
            return false;
        }

        function getSafeAnchor()
        {
            var rampart = creep.pos.findClosestByPath(FIND_MY_STRUCTURES,
            {
                filter: function(s) { return s.structureType == STRUCTURE_RAMPART; }
            }) || creep.pos.findClosestByRange(FIND_MY_STRUCTURES,
            {
                filter: function(s) { return s.structureType == STRUCTURE_RAMPART; }
            });
            if (rampart)
            {
                return rampart;
            }
            return creep.pos.findClosestByRange(FIND_MY_SPAWNS);
        }

        function moveToSafeAnchor()
        {
            var anchor = getSafeAnchor();
            if (!anchor)
            {
                return false;
            }
            var range = anchor.structureType == STRUCTURE_RAMPART ? 0 : 1;
            if (creep.pos.getRangeTo(anchor) > range)
            {
                creep.moveTo(anchor, {range: range, reusePath: 5});
                return true;
            }
            return false;
        }

        var targetRoom = creep.memory.target;
        if (targetRoom && !isValidRoomName(targetRoom))
        {
            clearDefenseTarget();
            creep.memory.targetError = 'invalid room ' + targetRoom;
            return;
        }
        if (targetRoom && creep.room.name != targetRoom)
        {
            clearDefenseTarget();
            var route = Game.map.findRoute(creep.room.name, targetRoom);
            if (Array.isArray(route) && route.length > 0)
            {
                var exitType = route[0].exit;
                var exitDirection = getExitMoveDirection(exitType);
                if (exitDirection && isOnExitEdge(creep, exitType))
                {
                    creep.move(exitDirection);
                    return;
                }

                var exit = creep.pos.findClosestByRange(exitType);
                if (exit)
                {
                    if (exitDirection && exit.isEqualTo(creep.pos))
                    {
                        creep.move(exitDirection);
                        return;
                    }
                    creep.moveTo(exit, {reusePath: 5});
                    return;
                }
            }
            var center = getRoomCenterPos(targetRoom);
            if (center)
            {
                creep.moveTo(center, {reusePath: 20});
            }
            return;
        }

        var hostile = getRecentTowerFocusTarget()
            || closestHostile((c) => isHostile(c) && isDangerous(c))
            || closestHostile(isHostile);
        if (hostile)
        {
            rememberDefenseTarget(hostile);
            var incomingDamage = combatMath.estimateIncomingDamage(creep, isHostile, isHostileStructure);
            var selfHeal = combatMath.directHealPower(creep);
            var projectedHits = combatMath.projectedHits(creep, incomingDamage, selfHeal);
            if (selfHeal > 0 && creep.hits < creep.hitsMax)
            {
                creep.heal(creep);
            }

            var rangeToHostile = creep.pos.getRangeTo(hostile);
            if (rangeToHostile <= 3)
            {
                var adjacentHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1,
                {
                    filter: isHostile
                });
                if (adjacentHostiles.length > 0)
                {
                    creep.rangedMassAttack();
                }
                else
                {
                    creep.rangedAttack(hostile);
                }
            }

            if (rangeToHostile > 3)
            {
                if (!hasOwnedRampart(creep.pos))
                {
                    creep.moveTo(hostile, {range: 3, reusePath: 3});
                }
            }
            else if (!hasOwnedRampart(creep.pos)
                && ((rangeToHostile <= 1 && combatMath.attackPower(hostile) > 0)
                    || (rangeToHostile <= 3 && incomingDamage > selfHeal)
                    || projectedHits < Math.max(150, Math.floor(creep.hitsMax * 0.25))))
            {
                if (!moveAwayFrom(hostile))
                {
                    moveToSafeAnchor();
                }
            }
        }
        else
        {
            clearDefenseTarget();
        }
    }
};

module.exports = roleDefender;
