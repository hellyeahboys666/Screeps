require('prototype.spawn')();
var roleHarvester = require('role.harvester');
var roleUpgrader = require('role.upgrader');
var roleBuilder = require('role.builder');
var roleRepairer = require('role.repairer');
var rolelongDistanceHarvester = require('role.longDistanceHarvester');
var roleClaimer = require('role.claimer');
var roleReserver = require('role.reserver');
var roleControllerAttacker = require('role.controllerAttacker');
var roleMiner = require('role.miner');
var roleLorry = require('role.lorry');
var roleRemoteLorry = require('role.remoteLorry');
var roleRemoteCarrier = require('role.remoteCarrier');
var roleRemoteBuilder = require('role.remoteBuilder');
var energyFallback = require('energy.fallback');
var energyReserveMarket = require('market.energyReserve');
var combatBoostMarket = require('market.combatBoosts');
var specialStructureMarket = require('market.specialStructures');
var mineralSellMarket = require('market.mineralSell');
var powerSpawnManager = require('power.spawn');
var powerCreepManager = require('manager.powerCreeps');
var combatMath = require('combat.math');
var remoteMining = require('manager.remoteMining');
var remoteBuild = require('manager.remoteBuild');
var creepCounts = require('creep.counts');
var movement = require('movement');
var sourceLinkUtils = require('source.link');
var trafficStats = require('traffic.stats');
var flowTraffic = require('traffic.flow');
var baseBuilderRuntime = require('base.builder.runtime');
var firstSpawnRuntime = require('base.builder.firstSpawnRuntime');
movement.install();
var roleAttacker = require('role.attacker');
var roleQuad = require('role.quad');
var roleDefender = require('role.defender');
var roleHealer = require('role.healer');
var roleRemoteHealer = require('role.remoteHealer');
var roleLinker = require('role.linker');
var roleExtractor = require('role.extractor');
var rolemineralLorry = require('role.mineralLorry');
var CONTROLLER_DOWNGRADE_SAFETY_TICKS = 5000;
var TOWER_RAMPART_DECAY_BUFFER_HITS = 3000;
var TOWER_RAMPART_EMERGENCY_REPAIR_HITS = 1000;
var TOWER_RAMPART_REPAIR_ENERGY_RESERVE = 300;
var TOWER_MAINTENANCE_MIN_RCL = 6;
var TOWER_MAINTENANCE_ENERGY_RESERVE = 600;
var RAMPART_REPAIRER_RESTART_RATIO = 0.95;
var TOWER_CRITICAL_HEAL_RATIO = 0.45;
var DEFAULT_RAMPART_TARGET_HITS = 100000;
var MINERAL_CONTAINER_LORRY_THRESHOLD = 1500;
var LOCAL_LORRY_SPAWN_ENERGY = 450;
var RCL6_LOCAL_LORRY_SPAWN_ENERGY = 900;
var RCL8_MINIMAL_UPGRADER_ENERGY = 200;
var MARKET_CHECK_INTERVAL = 1009;
var ROOM_STRUCTURE_CACHE_INTERVAL = 17;
var ROOM_FLAG_CACHE_INTERVAL = 23;
var BOOST_LAB_CACHE_INTERVAL = 43;
var COMBAT_T3_BOOSTS = [
    {key: 'combatTough', resource: RESOURCE_CATALYZED_GHODIUM_ALKALIDE, part: TOUGH},
    {key: 'combatRanged', resource: RESOURCE_CATALYZED_KEANIUM_ALKALIDE, part: RANGED_ATTACK},
    {key: 'combatHeal', resource: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, part: HEAL}
];
var COMBAT_BOOST_LAB_ASSIGNMENTS = [
    {key: 'combatTough', resource: RESOURCE_CATALYZED_GHODIUM_ALKALIDE},
    {key: 'combatHeal', resource: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE},
    {key: 'combatRanged', resource: RESOURCE_CATALYZED_KEANIUM_ALKALIDE}
];
var QUAD_MEMBER_BUNDLE_COST = 560;
var QUAD_MEMBER_FULL_BODY_COST = 4540;
var QUAD_BOOST_MINERAL_PER_PART = 30;
var QUAD_BOOST_ENERGY_PER_PART = 20;
var DEFAULT_DISTRIBUTED_QUAD_MAX_RANGE = 3;
var DEFAULT_DISTRIBUTED_QUAD_MAX_ROOMS = 4;
var AUTO_QUAD_RALLY_CACHE_TICKS = 200;
var AUTO_QUAD_RALLY_SEARCH_RANGE = 12;
var AUTO_QUAD_RALLY_FALLBACK_SEARCH_RANGE = 23;
var LOCAL_ROOM_ROLES = {
    harvester: true,
    upgrader: true,
    builder: true,
    repairer: true,
    miner: true,
    lorry: true,
    Slinker: true,
    Clinker: true,
    Blinker: true,
    extractor: true,
    mineralLorry: true
};

var TRAFFIC_MANAGER_STUCK_TICKS = 2;
var TRAFFIC_YIELD_TICKS = 3;
var TRAFFIC_ROLE_PRIORITY = {
    miner: 100,
    Slinker: 100,
    defender: 95,
    attacker: 90,
    healer: 90,
    remoteHealer: 90,
    remoteLorry: 75,
    remoteCarrier: 73,
    longDistanceHarvester: 72,
    lorry: 70,
    mineralLorry: 70,
    claimer: 68,
    controllerAttacker: 68,
    reserver: 65,
    Blinker: 64,
    Clinker: 60,
    harvester: 55,
    extractor: 50,
    upgrader: 35,
    remoteBuilder: 32,
    builder: 30,
    repairer: 30
};
var TRAFFIC_PROTECTED_YIELD_ROLES = {
    miner: true,
    Slinker: true,
    attacker: true,
    defender: true,
    healer: true,
    remoteHealer: true,
    quad: true,
    claimer: true,
    controllerAttacker: true
};

function assignLocalCreepHome(creep)
{
    if (creep.memory.home != undefined)
    {
        return;
    }
    if (creep.room.controller && creep.room.controller.my)
    {
        creep.memory.home = creep.room.name;
        return;
    }

    var closestSpawn = undefined;
    var closestDistance = undefined;
    for (let spawnName in Game.spawns)
    {
        let spawn = Game.spawns[spawnName];
        if (!spawn || !spawn.room)
        {
            continue;
        }
        let distance = Game.map.getRoomLinearDistance(creep.room.name, spawn.room.name);
        if (closestDistance == undefined || distance < closestDistance)
        {
            closestDistance = distance;
            closestSpawn = spawn;
        }
    }
    if (closestSpawn)
    {
        creep.memory.home = closestSpawn.room.name;
    }
}

function getLocalLorrySpawnEnergy(spawn)
{
    var targetEnergy = LOCAL_LORRY_SPAWN_ENERGY;
    if (spawn.room.controller
        && spawn.room.controller.level >= 6
        && spawn.room.terminal)
    {
        targetEnergy = RCL6_LOCAL_LORRY_SPAWN_ENERGY;
    }
    return Math.min(targetEnergy, spawn.room.energyCapacityAvailable);
}

function getUpgraderSpawnEnergy(spawn, energy)
{
    if (spawn.room.controller && spawn.room.controller.level >= 8)
    {
        // One [WORK, CARRY, MOVE] upgrader spends only one energy per tick.
        return Math.min(RCL8_MINIMAL_UPGRADER_ENERGY, energy);
    }
    return energy;
}

function ensureSpawnMemoryDefaults(spawn)
{
    if (!spawn || !spawn.memory)
    {
        return;
    }
    if (spawn.memory.rampartTargetHits == undefined)
    {
        spawn.memory.rampartTargetHits = DEFAULT_RAMPART_TARGET_HITS;
    }
}

function parseRampartTargetHits(value)
{
    if (typeof value == 'number' && isFinite(value) && value >= 0)
    {
        return Math.floor(value);
    }
    if (typeof value == 'string' && value.length > 0)
    {
        var parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed >= 0)
        {
            return parsed;
        }
    }
    return undefined;
}

function getSpawnRampartTargetHits(spawn)
{
    if (!spawn || !spawn.memory)
    {
        return DEFAULT_RAMPART_TARGET_HITS;
    }
    var configured = parseRampartTargetHits(spawn.memory.rampartTargetHits);
    if (configured != undefined)
    {
        return configured;
    }
    return DEFAULT_RAMPART_TARGET_HITS;
}

function updateRampartRepairStatus(spawn, ownedRamparts, rampartsBelowTarget, towerMaintenanceAvailable)
{
    var emptyPolicy = {
        targetEstablished: false,
        repairerRestartHits: 0,
        repairerRamparts: rampartsBelowTarget || [],
        towerMaintenanceRamparts: []
    };
    if (!spawn || !spawn.memory)
    {
        return emptyPolicy;
    }

    ownedRamparts = ownedRamparts || [];
    rampartsBelowTarget = rampartsBelowTarget || [];
    var targetHits = getSpawnRampartTargetHits(spawn);
    var repairerRestartHits = Math.floor(targetHits * RAMPART_REPAIRER_RESTART_RATIO);
    var roomMemory = spawn.room && spawn.room.memory;
    var maintenance = roomMemory ? roomMemory.rampartMaintenance : undefined;
    var sameRampartSet = maintenance
        && maintenance.targetHits == targetHits
        && maintenance.rampartCount == ownedRamparts.length;
    var targetEstablished = sameRampartSet && maintenance.targetEstablished == true;

    if (ownedRamparts.length <= 0)
    {
        targetEstablished = false;
    }
    else if (rampartsBelowTarget.length <= 0)
    {
        targetEstablished = true;
    }
    else if (!sameRampartSet)
    {
        // A target change or newly built/lost rampart requires initial dedicated
        // buildup before steady-state tower maintenance can take over again.
        targetEstablished = false;
    }

    if (roomMemory)
    {
        roomMemory.rampartMaintenance = {
            targetHits: targetHits,
            rampartCount: ownedRamparts.length,
            targetEstablished: targetEstablished,
            repairerRestartHits: repairerRestartHits,
            towerMaintenance: towerMaintenanceAvailable == true
        };
    }

    var repairerRamparts = rampartsBelowTarget.slice();
    var towerMaintenanceRamparts = [];
    if (targetEstablished && towerMaintenanceAvailable == true)
    {
        towerMaintenanceRamparts = rampartsBelowTarget.slice();
        repairerRamparts = rampartsBelowTarget.filter(function(rampart) {
            return rampart.hits < repairerRestartHits;
        });
    }

    spawn.memory.rampartCount = ownedRamparts.length;
    spawn.memory.rampartsBelowTarget = rampartsBelowTarget.length;
    spawn.memory.rampartsBelowRepairerThreshold = repairerRamparts.length;
    spawn.memory.rampartTargetEstablished = targetEstablished;
    spawn.memory.rampartRepairerRestartHits = repairerRestartHits;
    spawn.memory.towerRampartMaintenance = targetEstablished && towerMaintenanceAvailable == true;
    if (ownedRamparts.length > 0)
    {
        spawn.memory.weakestRampartHits = ownedRamparts[0].hits;
    }
    else
    {
        delete spawn.memory.weakestRampartHits;
    }

    return {
        targetEstablished: targetEstablished,
        repairerRestartHits: repairerRestartHits,
        repairerRamparts: repairerRamparts,
        towerMaintenanceRamparts: towerMaintenanceRamparts
    };
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

function moveTowardRoom(creep, roomName)
{
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
            creep.moveTo(exitPos, {reusePath: 20});
        }
    }
}

function keepLocalCreepInHomeRoom(creep)
{
    if (!creep.memory || !LOCAL_ROOM_ROLES[creep.memory.role])
    {
        return false;
    }
    if (creep.memory.target != undefined && creep.memory.target != creep.memory.home)
    {
        return false;
    }

    assignLocalCreepHome(creep);
    if (creep.memory.home != undefined && creep.room.name != creep.memory.home)
    {
        moveTowardRoom(creep, creep.memory.home);
        return true;
    }
    return false;
}

function isRoomCoord(x, y)
{
    return typeof x == 'number' && typeof y == 'number'
        && x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function getMoveAsideRequest(creep)
{
    var request = creep.memory.moveAsideForMiner;
    if (!request)
    {
        return undefined;
    }
    if (creep.memory.role == 'miner'
        || request.until == undefined
        || request.until < Game.time
        || request.roomName == undefined
        || !isRoomCoord(request.x, request.y))
    {
        delete creep.memory.moveAsideForMiner;
        return undefined;
    }
    return request;
}

function blocksMinerAccess(creep, request, source)
{
    if (creep.room.name != request.roomName)
    {
        return false;
    }
    var targetPos = new RoomPosition(request.x, request.y, request.roomName);
    if (creep.pos.isEqualTo(targetPos))
    {
        return true;
    }
    if (source && creep.pos.inRangeTo(source.pos, 1))
    {
        return true;
    }
    var miner = Game.creeps[request.miner];
    return miner
        && miner.room.name == creep.room.name
        && creep.pos.isNearTo(miner)
        && !miner.pos.isEqualTo(targetPos);
}

function isWalkableMoveAsidePosition(creep, pos, request, source)
{
    if (!pos || pos.roomName != creep.room.name)
    {
        return false;
    }
    if (pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49)
    {
        return false;
    }
    if (pos.x == creep.pos.x && pos.y == creep.pos.y)
    {
        return false;
    }
    if (pos.x == request.x && pos.y == request.y && pos.roomName == request.roomName)
    {
        return false;
    }
    if (source && pos.inRangeTo(source.pos, 1))
    {
        return false;
    }
    if (creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL)
    {
        return false;
    }
    if (pos.lookFor(LOOK_CREEPS).length > 0)
    {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD
            || structure.structureType == STRUCTURE_CONTAINER)
        {
            continue;
        }
        if (structure.structureType == STRUCTURE_RAMPART
            && (structure.my || structure.isPublic))
        {
            continue;
        }
        return false;
    }
    var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (let site of sites)
    {
        if (site.structureType == STRUCTURE_ROAD
            || site.structureType == STRUCTURE_CONTAINER
            || site.structureType == STRUCTURE_RAMPART)
        {
            continue;
        }
        return false;
    }
    return true;
}

function findMoveAsidePosition(creep, request, source)
{
    var targetPos = new RoomPosition(request.x, request.y, request.roomName);
    var best = undefined;
    var bestScore = undefined;
    for (let x = creep.pos.x - 1; x <= creep.pos.x + 1; x++)
    {
        for (let y = creep.pos.y - 1; y <= creep.pos.y + 1; y++)
        {
            if (x < 0 || x > 49 || y < 0 || y > 49)
            {
                continue;
            }
            var pos = new RoomPosition(x, y, creep.room.name);
            if (!isWalkableMoveAsidePosition(creep, pos, request, source))
            {
                continue;
            }
            var score = -pos.getRangeTo(targetPos) * 10;
            if (source)
            {
                score -= pos.getRangeTo(source.pos) * 5;
            }
            if (creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_SWAMP)
            {
                score += 3;
            }
            var structures = pos.lookFor(LOOK_STRUCTURES);
            var hasRoad = false;
            for (let structure of structures)
            {
                if (structure.structureType == STRUCTURE_ROAD)
                {
                    hasRoad = true;
                    break;
                }
            }
            if (!hasRoad)
            {
                score += 1;
            }
            if (best == undefined || score < bestScore)
            {
                best = pos;
                bestScore = score;
            }
        }
    }
    return best;
}

function handleMoveAsideForMiner(creep)
{
    var request = getMoveAsideRequest(creep);
    if (!request || creep.spawning)
    {
        return false;
    }
    var source = request.sourceId ? Game.getObjectById(request.sourceId) : undefined;
    if (!blocksMinerAccess(creep, request, source))
    {
        delete creep.memory.moveAsideForMiner;
        return false;
    }

    var moveAsidePos = findMoveAsidePosition(creep, request, source);
    if (!moveAsidePos)
    {
        return false;
    }
    creep.move(creep.pos.getDirectionTo(moveAsidePos));
    delete creep.memory.moveAsideForMiner;
    return true;
}

function isSpawnDropHauler(creep)
{
    return creep.memory.role == 'lorry'
        || creep.memory.role == 'remoteLorry';
}

function handleMoveAsideForSpawnDrop(creep)
{
    if (creep.spawning || isSpawnDropHauler(creep))
    {
        return false;
    }
    var dropPos = energyFallback.getSpawnDropPos(creep.room);
    if (!dropPos || !creep.pos.isEqualTo(dropPos))
    {
        return false;
    }

    var moveAsidePos = findMoveAsidePosition(creep,
    {
        x: dropPos.x,
        y: dropPos.y,
        roomName: dropPos.roomName
    }, undefined);
    if (!moveAsidePos)
    {
        return false;
    }
    creep.move(creep.pos.getDirectionTo(moveAsidePos));
    return true;
}

function isTrafficManagerEnabled()
{
    return Memory.trafficManagerEnabled !== false
        && Memory.civilianMovementEnabled != true
        && trafficStats.isEnabled();
}

function observeCreepMovementAfter(creep)
{
    flowTraffic.observeCreep(creep);
    trafficStats.observeCreepAfter(creep);
}

function getTrafficPriority(creep)
{
    if (!creep || !creep.memory)
    {
        return 0;
    }
    var role = creep.memory.role;
    var priority = TRAFFIC_ROLE_PRIORITY[role] || 10;
    if ((role == 'remoteLorry' || role == 'lorry' || role == 'mineralLorry')
        && creep.memory.empty == false)
    {
        priority += 20;
    }
    else if ((role == 'remoteLorry' || role == 'lorry')
        && creep.memory.empty == true)
    {
        priority += 5;
    }
    else if ((role == 'harvester' || role == 'builder' || role == 'upgrader'
        || role == 'repairer')
        && creep.memory.empty == false)
    {
        priority += 5;
    }
    return priority;
}

function getTrafficTargetPos(creep)
{
    if (!creep || !creep.memory || !creep.memory._move || !creep.memory._move.dest)
    {
        return undefined;
    }
    var dest = creep.memory._move.dest;
    var roomName = dest.room || dest.roomName || creep.room.name;
    if (roomName != creep.room.name || !isRoomCoord(dest.x, dest.y))
    {
        return undefined;
    }
    return new RoomPosition(dest.x, dest.y, roomName);
}

function getPositionInDirection(pos, direction)
{
    var dx = 0;
    var dy = 0;
    if (direction == TOP || direction == TOP_RIGHT || direction == TOP_LEFT)
    {
        dy = -1;
    }
    else if (direction == BOTTOM || direction == BOTTOM_RIGHT || direction == BOTTOM_LEFT)
    {
        dy = 1;
    }
    if (direction == RIGHT || direction == TOP_RIGHT || direction == BOTTOM_RIGHT)
    {
        dx = 1;
    }
    else if (direction == LEFT || direction == TOP_LEFT || direction == BOTTOM_LEFT)
    {
        dx = -1;
    }
    if (!isRoomCoord(pos.x + dx, pos.y + dy))
    {
        return undefined;
    }
    return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
}

function canYieldForTraffic(blocker, requesterPriority)
{
    if (!blocker || blocker.spawning || !blocker.my || !blocker.memory || blocker.fatigue > 0)
    {
        return false;
    }
    if (TRAFFIC_PROTECTED_YIELD_ROLES[blocker.memory.role])
    {
        return false;
    }
    if (blocker.memory.moveAsideForMiner)
    {
        return false;
    }
    return getTrafficPriority(blocker) < requesterPriority;
}

function findTrafficBlockerToYield(requester, requesterPriority, targetPos)
{
    var directNextPos = undefined;
    if (targetPos)
    {
        directNextPos = getPositionInDirection(requester.pos, requester.pos.getDirectionTo(targetPos));
    }
    var blockers = requester.pos.findInRange(FIND_MY_CREEPS, 1,
    {
        filter: (c) => c.name != requester.name && canYieldForTraffic(c, requesterPriority)
    });
    var best = undefined;
    var bestScore = undefined;
    for (let blocker of blockers)
    {
        var score = 0;
        if (directNextPos && blocker.pos.isEqualTo(directNextPos))
        {
            score += 1000;
        }
        if (targetPos)
        {
            score += Math.max(0, 20 - blocker.pos.getRangeTo(targetPos));
        }
        score -= getTrafficPriority(blocker);
        if (blocker.memory.role == 'upgrader' || blocker.memory.role == 'builder'
            || blocker.memory.role == 'repairer'
            || blocker.memory.role == 'harvester')
        {
            score += 10;
        }
        if (best == undefined || score > bestScore)
        {
            best = blocker;
            bestScore = score;
        }
    }
    return best;
}

function markTrafficYield(blocker, requester, requesterPriority, targetPos)
{
    var existing = blocker.memory.moveAsideForTraffic;
    if (existing && existing.until >= Game.time && existing.priority > requesterPriority)
    {
        return false;
    }
    blocker.memory.moveAsideForTraffic = {
        requester: requester.name,
        requesterRole: requester.memory.role,
        priority: requesterPriority,
        roomName: requester.pos.roomName,
        x: requester.pos.x,
        y: requester.pos.y,
        destRoomName: targetPos ? targetPos.roomName : undefined,
        destX: targetPos ? targetPos.x : undefined,
        destY: targetPos ? targetPos.y : undefined,
        returnRoomName: blocker.pos.roomName,
        returnX: blocker.pos.x,
        returnY: blocker.pos.y,
        until: Game.time + TRAFFIC_YIELD_TICKS
    };
    return true;
}

function requestTrafficYieldForStuckCreep(creep)
{
    if (!isTrafficManagerEnabled() || creep.spawning || creep.fatigue > 0
        || !creep.memory || !creep.memory._trafficStuckTicks
        || creep.memory._trafficStuckTicks < TRAFFIC_MANAGER_STUCK_TICKS)
    {
        return false;
    }
    var targetPos = getTrafficTargetPos(creep);
    if (!targetPos)
    {
        return false;
    }
    var priority = getTrafficPriority(creep);
    if (priority < 30)
    {
        return false;
    }
    var blocker = findTrafficBlockerToYield(creep, priority, targetPos);
    if (!blocker)
    {
        return false;
    }
    return markTrafficYield(blocker, creep, priority, targetPos);
}

function getTrafficYieldRequest(creep)
{
    var request = creep.memory.moveAsideForTraffic;
    if (!request)
    {
        return undefined;
    }
    if (request.until == undefined || request.until < Game.time
        || request.roomName == undefined || !isRoomCoord(request.x, request.y))
    {
        delete creep.memory.moveAsideForTraffic;
        return undefined;
    }
    if (request.destX != undefined && !isRoomCoord(request.destX, request.destY))
    {
        delete creep.memory.moveAsideForTraffic;
        return undefined;
    }
    return request;
}

function isSourceAccessPos(pos)
{
    if (!pos || !Game.rooms[pos.roomName])
    {
        return false;
    }
    var sources = pos.findInRange(FIND_SOURCES, 1);
    return sources.length > 0;
}

function hasRoad(pos)
{
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD)
        {
            return true;
        }
    }
    return false;
}

function isWalkableTrafficYieldPosition(creep, pos, request, strict)
{
    if (!isWalkableMoveAsidePosition(creep, pos, request, undefined))
    {
        return false;
    }
    if (request.destX != undefined
        && pos.x == request.destX
        && pos.y == request.destY
        && pos.roomName == (request.destRoomName || request.roomName))
    {
        return false;
    }
    if (strict && isSourceAccessPos(pos))
    {
        return false;
    }
    return true;
}

function findTrafficYieldPosition(creep, request, strict)
{
    var requesterPos = new RoomPosition(request.x, request.y, request.roomName);
    var destPos = request.destX != undefined
        ? new RoomPosition(request.destX, request.destY, request.destRoomName || request.roomName)
        : undefined;
    var returnPos = request.returnX != undefined && isRoomCoord(request.returnX, request.returnY)
        ? new RoomPosition(request.returnX, request.returnY, request.returnRoomName || creep.room.name)
        : undefined;
    var best = undefined;
    var bestScore = undefined;
    for (let x = creep.pos.x - 1; x <= creep.pos.x + 1; x++)
    {
        for (let y = creep.pos.y - 1; y <= creep.pos.y + 1; y++)
        {
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            var pos = new RoomPosition(x, y, creep.room.name);
            if (!isWalkableTrafficYieldPosition(creep, pos, request, strict))
            {
                continue;
            }
            var score = pos.getRangeTo(requesterPos) * 20;
            if (destPos && destPos.roomName == pos.roomName)
            {
                score += pos.getRangeTo(destPos) * 5;
            }
            if (returnPos && returnPos.roomName == pos.roomName)
            {
                score -= pos.getRangeTo(returnPos);
            }
            if (hasRoad(pos))
            {
                score -= 3;
            }
            if (pos.x == 0 || pos.x == 49 || pos.y == 0 || pos.y == 49)
            {
                score -= 25;
            }
            if (best == undefined || score > bestScore)
            {
                best = pos;
                bestScore = score;
            }
        }
    }
    return best;
}

function handleMoveAsideForTraffic(creep)
{
    if (!isTrafficManagerEnabled() || creep.spawning || !creep.memory)
    {
        return false;
    }
    var request = getTrafficYieldRequest(creep);
    if (!request)
    {
        return false;
    }
    var requester = Game.creeps[request.requester];
    if (!requester || requester.room.name != creep.room.name
        || !creep.pos.isNearTo(requester)
        || !canYieldForTraffic(creep, request.priority))
    {
        delete creep.memory.moveAsideForTraffic;
        return false;
    }
    var moveAsidePos = findTrafficYieldPosition(creep, request, true)
        || findTrafficYieldPosition(creep, request, false);
    if (!moveAsidePos)
    {
        delete creep.memory.moveAsideForTraffic;
        return false;
    }
    creep.move(creep.pos.getDirectionTo(moveAsidePos));
    creep.memory.trafficReturn = {
        roomName: request.returnRoomName || creep.room.name,
        x: request.returnX,
        y: request.returnY,
        until: Game.time + 8
    };
    delete creep.memory.moveAsideForTraffic;
    return true;
}

function isControllerDowngradeEmergency(room)
{
    return room.controller
        && room.controller.my
        && room.controller.ticksToDowngrade != undefined
        && room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY_TICKS;
}

function getCpuCache(room)
{
    room.memory = room.memory || {};
    room.memory.cpuCache = room.memory.cpuCache || {};
    return room.memory.cpuCache;
}

function getStablePhase(seed, interval)
{
    var hash = 0;
    seed = seed || '';
    for (var i = 0; i < seed.length; i++)
    {
        hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % interval;
}

function getNextStaggeredTick(interval, seed)
{
    var phase = getStablePhase(seed, interval);
    var delay = (phase - (Game.time % interval) + interval) % interval;
    if (delay == 0)
    {
        delay = interval;
    }
    return Game.time + delay;
}

function shouldRunStaggered(memory, key, interval, seed, force)
{
    if (force || memory[key] == undefined || Game.time >= memory[key])
    {
        memory[key] = getNextStaggeredTick(interval, seed);
        return true;
    }
    return false;
}

function shouldRunMarketCheck(spawn)
{
    if (!isPrimaryRoomSpawn(spawn))
    {
        return false;
    }
    return shouldRunStaggered(spawn.memory,
        'nextMarketCheck',
        MARKET_CHECK_INTERVAL,
        spawn.name + ':market',
        spawn.memory.combatBoostMarketStatus == undefined
            || spawn.memory.specialStructureMarketStatus == undefined);
}

function idsToObjects(ids)
{
    var objects = [];
    if (!ids)
    {
        return objects;
    }
    for (let id of ids)
    {
        var object = Game.getObjectById(id);
        if (object)
        {
            objects.push(object);
        }
    }
    return objects;
}

function sourceHasAdjacentStructure(source, structures, structureType)
{
    for (let structure of structures)
    {
        if (structure.structureType != structureType)
        {
            continue;
        }
        if (structureType == STRUCTURE_LINK)
        {
            if (sourceLinkUtils.isUsableSourceLink(source, structure))
            {
                return true;
            }
        }
        else if (structure.pos.inRangeTo(source, 1))
        {
            return true;
        }
    }
    return false;
}

function getCachedRoomPlan(room)
{
    var cache = getCpuCache(room);
    var force = cache.sourceIds == undefined
        || cache.sourceContainerSourceIds == undefined
        || cache.sourceLinkSourceIds == undefined
        || cache.controllerLinkIds == undefined
        || cache.baseLinkIds == undefined
        || cache.extractorIds == undefined
        || cache.towerIds == undefined
        || cache.constructionSiteCount == undefined
        || cache.mineralId === undefined
        || cache.mineralContainerId === undefined;
    if (shouldRunStaggered(cache,
        'nextRoomStructureCheck',
        ROOM_STRUCTURE_CACHE_INTERVAL,
        room.name + ':structures',
        force))
    {
        var sources = room.find(FIND_SOURCES);
        var structures = room.find(FIND_STRUCTURES);
        var sourceIds = [];
        var sourceContainerSourceIds = {};
        var sourceLinkSourceIds = {};
        var sourceContainerCount = 0;
        var controllerLinkIds = [];
        var baseLinkIds = [];
        var extractorIds = [];
        var towerIds = [];
        var minerals = room.find(FIND_MINERALS);
        var constructionSites = room.find(FIND_CONSTRUCTION_SITES);
        var mineral = minerals[0];
        var mineralContainerId = false;
        if (mineral)
        {
            let mineralContainer = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (s) => s.structureType == STRUCTURE_CONTAINER
            })[0];
            mineralContainerId = mineralContainer ? mineralContainer.id : false;
        }

        for (let source of sources)
        {
            sourceIds.push(source.id);
            if (sourceHasAdjacentStructure(source, structures, STRUCTURE_CONTAINER))
            {
                sourceContainerSourceIds[source.id] = true;
                sourceContainerCount++;
            }
            if (sourceHasAdjacentStructure(source, structures, STRUCTURE_LINK))
            {
                sourceLinkSourceIds[source.id] = true;
            }
        }
        for (let structure of structures)
        {
            if (structure.structureType == STRUCTURE_TOWER)
            {
                towerIds.push(structure.id);
            }
            else if (structure.structureType == STRUCTURE_LINK)
            {
                if (room.controller && sourceLinkUtils.isUsableControllerLink(room.controller, structure))
                {
                    controllerLinkIds.push(structure.id);
                }
                if (room.storage && structure.pos.inRangeTo(room.storage, 3))
                {
                    baseLinkIds.push(structure.id);
                }
            }
            else if (structure.structureType == STRUCTURE_EXTRACTOR && structure.my)
            {
                extractorIds.push(structure.id);
            }
        }

        cache.sourceIds = sourceIds;
        cache.sourceContainerSourceIds = sourceContainerSourceIds;
        cache.sourceLinkSourceIds = sourceLinkSourceIds;
        cache.sourceContainerCount = sourceContainerCount;
        cache.controllerLinkIds = controllerLinkIds;
        cache.baseLinkIds = baseLinkIds;
        cache.extractorIds = extractorIds;
        cache.towerIds = towerIds;
        cache.constructionSiteCount = constructionSites.length;
        cache.mineralId = mineral ? mineral.id : false;
        cache.mineralType = mineral ? mineral.mineralType : undefined;
        cache.mineralContainerId = mineralContainerId;
        cache.lastRoomStructureCheck = Game.time;
    }

    var mineral = cache.mineralId ? Game.getObjectById(cache.mineralId) : undefined;
    if (cache.mineralId && (!mineral || !mineral.pos || mineral.pos.roomName != room.name))
    {
        cache.mineralId = undefined;
        cache.mineralContainerId = undefined;
        mineral = undefined;
    }
    var mineralAmount = mineral ? (mineral.mineralAmount || 0) : 0;
    var mineralRegeneration = mineral ? mineral.ticksToRegeneration : undefined;
    var mineralType = mineral ? mineral.mineralType : cache.mineralType;
    var mineralReady = mineralAmount > 0;
    var mineralContainer = cache.mineralContainerId ? Game.getObjectById(cache.mineralContainerId) : undefined;
    var mineralContainerMineralAmount = 0;
    if (mineralContainer && (!mineralContainer.pos
        || mineralContainer.pos.roomName != room.name
        || mineralContainer.structureType != STRUCTURE_CONTAINER))
    {
        cache.mineralContainerId = undefined;
        mineralContainer = undefined;
    }
    if (mineralContainer && mineralType)
    {
        mineralContainerMineralAmount = mineralContainer.store.getUsedCapacity(mineralType) || 0;
    }

    return {
        sources: idsToObjects(cache.sourceIds),
        sourceContainerSourceIds: cache.sourceContainerSourceIds || {},
        sourceLinkSourceIds: cache.sourceLinkSourceIds || {},
        sourceContainerCount: cache.sourceContainerCount || 0,
        controllerLinks: idsToObjects(cache.controllerLinkIds),
        baseLinks: idsToObjects(cache.baseLinkIds),
        extractors: idsToObjects(cache.extractorIds),
        controllerLinkReady: (cache.controllerLinkIds || []).length > 0,
        baseLinkReady: (cache.baseLinkIds || []).length > 0,
        extractorReady: (cache.extractorIds || []).length > 0,
        mineralId: mineral ? mineral.id : undefined,
        mineralType: mineralType,
        mineralAmount: mineralAmount,
        mineralRegeneration: mineralRegeneration,
        mineralReady: mineralReady,
        mineralContainerId: mineralContainer ? mineralContainer.id : undefined,
        mineralContainerMineralAmount: mineralContainerMineralAmount,
        mineralContainerNeedsLorry: mineralContainerMineralAmount > MINERAL_CONTAINER_LORRY_THRESHOLD,
        constructionSiteCount: cache.constructionSiteCount || 0,
        towers: idsToObjects(cache.towerIds)
    };
}

function getCachedWhiteFlagPlan(room, sources, sourceLinkSourceIds)
{
    var cache = getCpuCache(room);
    var force = cache.whiteFlagCount == undefined || cache.whiteFlagSourceIds == undefined;
    if (shouldRunStaggered(cache,
        'nextRoomFlagCheck',
        ROOM_FLAG_CACHE_INTERVAL,
        room.name + ':flags',
        force))
    {
        var flags = room.find(FIND_FLAGS);
        var whiteFlagCount = 0;
        var whiteFlagSourceIds = {};
        for (let flag of flags)
        {
            if (flag.color != COLOR_WHITE)
            {
                continue;
            }
            let flagSource = flag.pos.findClosestByRange(sources);
            if (flagSource && sourceLinkSourceIds[flagSource.id]
                && !whiteFlagSourceIds[flagSource.id])
            {
                whiteFlagCount++;
                whiteFlagSourceIds[flagSource.id] = true;
            }
        }
        cache.whiteFlagCount = whiteFlagCount;
        cache.whiteFlagSourceIds = whiteFlagSourceIds;
        cache.lastRoomFlagCheck = Game.time;
    }
    return {
        count: cache.whiteFlagCount || 0,
        sourceIds: cache.whiteFlagSourceIds || {}
    };
}

function getLabWithResource(room, resourceType)
{
    if (!room.terminal)
    {
        return undefined;
    }
    var labs = room.find(FIND_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_LAB
            && s.store.getUsedCapacity(resourceType) > 0
    });
    return room.terminal.pos.findClosestByPath(labs);
}

function getOwnedLabsByConstructionOrder(room)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.ownedLabsByConstructionOrder)
    {
        return cache.ownedLabsByConstructionOrder;
    }
    var labs = room.find(FIND_MY_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_LAB
    });
    labs.sort(function(a, b)
    {
        if (a.id < b.id)
        {
            return -1;
        }
        if (a.id > b.id)
        {
            return 1;
        }
        return 0;
    });
    if (cache)
    {
        cache.ownedLabsByConstructionOrder = labs;
    }
    return labs;
}

function getCombatBoostLabAssignments(room)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.combatBoostLabAssignments)
    {
        return cache.combatBoostLabAssignments;
    }
    var labs = getOwnedLabsByConstructionOrder(room);
    var assignments = {};
    for (let i = 0; i < COMBAT_BOOST_LAB_ASSIGNMENTS.length && i < labs.length; i++)
    {
        let assignment = COMBAT_BOOST_LAB_ASSIGNMENTS[i];
        assignments[assignment.key] = {
            lab: labs[i],
            resource: assignment.resource
        };
    }
    if (cache)
    {
        cache.combatBoostLabAssignments = assignments;
    }
    return assignments;
}

function isLabUsableForResource(lab, resourceType)
{
    return lab != undefined
        && (lab.mineralType == undefined
            || lab.mineralType == resourceType
            || lab.store.getUsedCapacity(resourceType) > 0);
}

function getAssignedCombatBoostLab(room, key, resourceType)
{
    var assignments = getCombatBoostLabAssignments(room);
    var assignment = assignments[key];
    if (assignment && isLabUsableForResource(assignment.lab, resourceType))
    {
        return assignment.lab;
    }
    return getLabWithResource(room, resourceType);
}

function hasMineralLorryForLab(creepsInRoom, labId, resourceType)
{
    return _.some(creepsInRoom, (c) => c.memory.role == 'mineralLorry'
        && c.memory.labId == labId
        && c.memory.mineralType == resourceType);
}

function hasMineralLorryForContainer(creepsInRoom, containerId, resourceType)
{
    return _.some(creepsInRoom, (c) => c.memory.role == 'mineralLorry'
        && c.memory.sourceContainerId == containerId
        && c.memory.mineralType == resourceType);
}

function hasMineralLorryForSpecialStructure(creepsInRoom, structureId, resourceType)
{
    return _.some(creepsInRoom, (c) => c.memory.role == 'mineralLorry'
        && c.memory.specialStructureId == structureId
        && c.memory.mineralType == resourceType);
}

function getCombatBoostLabLoadRequest(spawn, creepsInRoom)
{
    if (!spawn.room.terminal)
    {
        delete spawn.memory.combatBoostLabAssignments;
        delete spawn.memory.combatBoostLabLoadRequest;
        return undefined;
    }

    var assignments = getCombatBoostLabAssignments(spawn.room);
    var planMemory = [];
    var request = undefined;
    for (let assignment of COMBAT_BOOST_LAB_ASSIGNMENTS)
    {
        let boostLab = assignments[assignment.key];
        if (!boostLab || !boostLab.lab)
        {
            planMemory.push({key: assignment.key, resource: assignment.resource, status: 'missing lab'});
            continue;
        }

        let lab = boostLab.lab;
        let labId = lab.id;
        let stored = lab.store.getUsedCapacity(assignment.resource);
        let free = lab.store.getFreeCapacity(assignment.resource);
        let terminalAmount = spawn.room.terminal.store.getUsedCapacity(assignment.resource);
        let storageAmount = spawn.room.storage ? spawn.room.storage.store.getUsedCapacity(assignment.resource) : 0;
        let wrongMineral = lab.mineralType != undefined
            && lab.mineralType != assignment.resource
            && stored == 0;
        let status = 'ready';
        if (wrongMineral)
        {
            status = 'wrong mineral ' + lab.mineralType;
        }
        else if (free <= 0)
        {
            status = 'full';
        }
        else if (terminalAmount + storageAmount <= 0)
        {
            status = 'waiting for mineral';
        }
        else if (hasMineralLorryForLab(creepsInRoom, labId, assignment.resource))
        {
            status = 'lorry assigned';
        }
        else
        {
            status = 'needs lorry';
        }

        planMemory.push({
            key: assignment.key,
            resource: assignment.resource,
            labId: labId,
            x: lab.pos.x,
            y: lab.pos.y,
            stored: stored,
            free: free,
            available: terminalAmount + storageAmount,
            status: status
        });

        if (request == undefined && status == 'needs lorry')
        {
            request = {
                key: assignment.key,
                resource: assignment.resource,
                labId: labId
            };
        }
    }

    spawn.memory.combatBoostLabAssignments = planMemory;
    if (request)
    {
        spawn.memory.combatBoostLabLoadRequest = request;
    }
    else
    {
        delete spawn.memory.combatBoostLabLoadRequest;
    }
    return request;
}

function getCachedBoostLabs(room)
{
    var cache = getCpuCache(room);
    if (!room.terminal)
    {
        cache.boostLabIds = {};
        return {};
    }
    if (shouldRunStaggered(cache,
        'nextBoostLabCheck',
        BOOST_LAB_CACHE_INTERVAL,
        room.name + ':boostLabs',
        cache.boostLabIds == undefined))
    {
        var uLab = getLabWithResource(room, RESOURCE_CATALYZED_GHODIUM_ACID);
        var toughLab = getAssignedCombatBoostLab(room, 'combatTough', RESOURCE_CATALYZED_GHODIUM_ALKALIDE);
        var rangedLab = getAssignedCombatBoostLab(room, 'combatRanged', RESOURCE_CATALYZED_KEANIUM_ALKALIDE);
        var healLab = getAssignedCombatBoostLab(room, 'combatHeal', RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE);
        cache.boostLabIds = {
            upgrader: uLab ? uLab.id : undefined,
            attacker: rangedLab ? rangedLab.id : undefined,
            healer: healLab ? healLab.id : undefined,
            combatTough: toughLab ? toughLab.id : undefined,
            combatRanged: rangedLab ? rangedLab.id : undefined,
            combatHeal: healLab ? healLab.id : undefined
        };
        cache.lastBoostLabCheck = Game.time;
    }

    var labIds = cache.boostLabIds || {};
    return {
        upgrader: labIds.upgrader ? Game.getObjectById(labIds.upgrader) : undefined,
        attacker: labIds.attacker ? Game.getObjectById(labIds.attacker) : undefined,
        healer: labIds.healer ? Game.getObjectById(labIds.healer) : undefined,
        combatTough: labIds.combatTough ? Game.getObjectById(labIds.combatTough) : undefined,
        combatRanged: labIds.combatRanged ? Game.getObjectById(labIds.combatRanged) : undefined,
        combatHeal: labIds.combatHeal ? Game.getObjectById(labIds.combatHeal) : undefined
    };
}

function getBoostLab(room, boost)
{
    var boostLabs = getCachedBoostLabs(room);
    return boostLabs[boost.key] || getLabWithResource(room, boost.resource);
}

function hasUnboostedActiveBodyPart(creep, bodyPart)
{
    for (let part of creep.body)
    {
        if (part.type == bodyPart && part.hits > 0 && part.boost == undefined)
        {
            return true;
        }
    }
    return false;
}

function markBoostPartComplete(creep, key)
{
    creep.memory.boostedParts = creep.memory.boostedParts || {};
    creep.memory.boostedParts[key] = true;
}

function getCombatBoostProfile(creep)
{
    if (!creep.memory || Memory.combatBoostingEnabled === false)
    {
        return undefined;
    }
    if (creep.memory.boostProfile == 'combatT3'
        || creep.memory.wantsCombatBoosts == true
        || (creep.memory.role == 'attacker' && creep.memory.wantsBoost == true))
    {
        return COMBAT_T3_BOOSTS;
    }
    return undefined;
}

function shouldWaitForCombatBoost(creep)
{
    if (creep.memory.boostStrict != undefined)
    {
        return creep.memory.boostStrict == true;
    }
    return (creep.memory.role == 'quad' && creep.memory.wantsCombatBoosts == true)
        || (creep.memory.role == 'attacker' && creep.memory.wantsBoost == true);
}

function isCombatBoostProfileComplete(creep, profile)
{
    if (!profile)
    {
        return true;
    }
    for (let boost of profile)
    {
        if (hasUnboostedActiveBodyPart(creep, boost.part))
        {
            return false;
        }
    }
    return true;
}

function isQuadSquadCombatBoosted(creep)
{
    if (creep.memory.role != 'quad')
    {
        return true;
    }
    var squad = creep.memory.squad || creep.memory.squadId || 'default';
    var members = 0;
    for (let name in Game.creeps)
    {
        let member = Game.creeps[name];
        if (!member.memory || member.memory.role != 'quad')
        {
            continue;
        }
        let memberSquad = member.memory.squad || member.memory.squadId || 'default';
        if (memberSquad != squad)
        {
            continue;
        }
        members++;
        if (!isCombatBoostProfileComplete(member, getCombatBoostProfile(member)))
        {
            return false;
        }
    }
    return members >= 4;
}

function handleCombatBoosting(creep)
{
    var profile = getCombatBoostProfile(creep);
    if (!profile)
    {
        return false;
    }
    if (creep.memory.boosted == true && isCombatBoostProfileComplete(creep, profile))
    {
        if (creep.memory.role == 'quad')
        {
            return false;
        }
        if (!isQuadSquadCombatBoosted(creep))
        {
            creep.memory.boostStep = 'waitingForSquad';
            return true;
        }
        return false;
    }
    if (creep.spawning)
    {
        return true;
    }
    if (creep.memory.home && creep.room.name != creep.memory.home)
    {
        return false;
    }

    for (let boost of profile)
    {
        if (!hasUnboostedActiveBodyPart(creep, boost.part))
        {
            markBoostPartComplete(creep, boost.key);
            continue;
        }

        var lab = getBoostLab(creep.room, boost);
        creep.memory.boostStep = boost.key;
        creep.memory.boostResource = boost.resource;
        if (!lab)
        {
            creep.memory.boostError = 'missing lab for ' + boost.resource;
            return shouldWaitForCombatBoost(creep);
        }

        var boostResult = lab.boostCreep(creep);
        if (boostResult == OK)
        {
            markBoostPartComplete(creep, boost.key);
            delete creep.memory.boostError;
            return true;
        }
        if (boostResult == ERR_NOT_IN_RANGE)
        {
            if (!shouldWaitForCombatBoost(creep))
            {
                return false;
            }
            creep.moveTo(lab, {reusePath: 5, range: 1});
            return true;
        }

        creep.memory.boostError = boost.resource + ':' + boostResult;
        return shouldWaitForCombatBoost(creep);
    }

    creep.memory.boosted = true;
    delete creep.memory.boostStep;
    delete creep.memory.boostResource;
    delete creep.memory.boostError;
    if (creep.memory.role == 'quad')
    {
        return false;
    }
    if (!isQuadSquadCombatBoosted(creep))
    {
        creep.memory.boostStep = 'waitingForSquad';
        return true;
    }
    return false;
}

function getAutoSafeModePauseUntil(room, spawn)
{
    var until = 0;
    if (typeof Memory.autoSafeModePauseUntil == 'number')
    {
        until = Math.max(until, Memory.autoSafeModePauseUntil);
    }
    if (room && room.memory && typeof room.memory.autoSafeModePauseUntil == 'number')
    {
        until = Math.max(until, room.memory.autoSafeModePauseUntil);
    }
    if (spawn && spawn.memory && typeof spawn.memory.autoSafeModePauseUntil == 'number')
    {
        until = Math.max(until, spawn.memory.autoSafeModePauseUntil);
    }
    return until;
}

function isAutoSafeModePaused(room, spawn)
{
    return getAutoSafeModePauseUntil(room, spawn) > Game.time;
}

function isAutoSafeModeEnabled(room, spawn)
{
    return !isAutoSafeModePaused(room, spawn)
        && Memory.autoSafeMode !== false
        && (!room.memory || room.memory.autoSafeMode !== false)
        && (!spawn || !spawn.memory || spawn.memory.autoSafeMode !== false);
}

function getTowerPauseUntil(room)
{
    var until = 0;
    if (typeof Memory.towerPauseUntil == 'number')
    {
        until = Math.max(until, Memory.towerPauseUntil);
    }
    if (room && room.memory && typeof room.memory.towerPauseUntil == 'number')
    {
        until = Math.max(until, room.memory.towerPauseUntil);
    }
    return until;
}

function isTowerPaused(room)
{
    return getTowerPauseUntil(room) > Game.time;
}

function getOwnerName(object)
{
    return object && object.owner ? object.owner.username : 'unknown';
}

function isNpcHostileOwnerName(username)
{
    return username == 'Invader' || username == 'Source Keeper';
}

function isNonAllyHostileCreep(creep)
{
    return getOwnerName(creep) != 'MoMoCat';
}

function isPlayerHostileCreep(creep)
{
    var username = getOwnerName(creep);
    return username != 'MoMoCat' && !isNpcHostileOwnerName(username);
}

function getTowerActionEnergyCost()
{
    return typeof TOWER_ENERGY_COST == 'number' ? TOWER_ENERGY_COST : 10;
}

function getTowerEnergy(tower)
{
    if (!tower)
    {
        return 0;
    }
    if (tower.store)
    {
        return tower.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    }
    return tower.energy || 0;
}

function isTowerActionReady(tower)
{
    return tower && getTowerEnergy(tower) >= getTowerActionEnergyCost();
}

function getTowerEffectAt(tower, target, basePower)
{
    if (!tower || !tower.pos || !target)
    {
        return 0;
    }
    var pos = target.pos || target;
    if (!pos)
    {
        return 0;
    }
    var range = tower.pos.getRangeTo(pos);
    var falloff = typeof TOWER_FALLOFF == 'number' ? TOWER_FALLOFF : 0.75;
    var optimal = typeof TOWER_OPTIMAL_RANGE == 'number' ? TOWER_OPTIMAL_RANGE : 5;
    var falloffRange = typeof TOWER_FALLOFF_RANGE == 'number' ? TOWER_FALLOFF_RANGE : 20;
    if (range <= optimal)
    {
        return basePower;
    }
    if (range >= falloffRange)
    {
        return basePower * (1 - falloff);
    }
    return basePower * (1 - falloff * (range - optimal) / (falloffRange - optimal));
}

function getTowerAttackPowerAt(tower, target)
{
    var attackPower = typeof TOWER_POWER_ATTACK == 'number' ? TOWER_POWER_ATTACK : 600;
    return getTowerEffectAt(tower, target, attackPower);
}

function getTowerHealPowerAt(tower, target)
{
    var healPower = typeof TOWER_POWER_HEAL == 'number' ? TOWER_POWER_HEAL : 400;
    return getTowerEffectAt(tower, target, healPower);
}

function getActivePartCount(creep, partType)
{
    if (!creep || !creep.getActiveBodyparts)
    {
        return 0;
    }
    return creep.getActiveBodyparts(partType) || 0;
}

function getTowerHostileThreatScore(hostile)
{
    if (!hostile)
    {
        return 0;
    }
    var dismantlePower = typeof DISMANTLE_POWER == 'number' ? DISMANTLE_POWER : 50;
    var claimThreat = getActivePartCount(hostile, CLAIM) > 0 ? 250 : 0;
    return combatMath.attackPower(hostile)
        + combatMath.rangedAttackPower(hostile)
        + combatMath.directHealPower(hostile)
        + combatMath.rangedHealPower(hostile)
        + getActivePartCount(hostile, WORK) * dismantlePower
        + claimThreat;
}

function isDangerousTowerHostile(hostile)
{
    return getTowerHostileThreatScore(hostile) > 0;
}

function estimateHostileTowerDamage(hostile, activeTowers)
{
    if (!hostile || !activeTowers || activeTowers.length == 0)
    {
        return 0;
    }
    var rawDamage = 0;
    for (var i = 0; i < activeTowers.length; i++)
    {
        rawDamage += getTowerAttackPowerAt(activeTowers[i], hostile);
    }
    return combatMath.damageAfterTough(hostile, rawDamage);
}

function estimateBestSingleTowerDamage(hostile, activeTowers)
{
    var best = 0;
    if (!hostile || !activeTowers)
    {
        return best;
    }
    for (var i = 0; i < activeTowers.length; i++)
    {
        var damage = combatMath.damageAfterTough(hostile, getTowerAttackPowerAt(activeTowers[i], hostile));
        if (damage > best)
        {
            best = damage;
        }
    }
    return best;
}

function estimateHostileHealing(hostile, hostiles)
{
    if (!hostile || !hostiles)
    {
        return 0;
    }
    var heal = 0;
    for (var i = 0; i < hostiles.length; i++)
    {
        var healer = hostiles[i];
        if (!healer || !healer.pos || healer.pos.roomName != hostile.pos.roomName)
        {
            continue;
        }
        var directHeal = combatMath.directHealPower(healer);
        var rangedHeal = combatMath.rangedHealPower(healer);
        if (directHeal <= 0 && rangedHeal <= 0)
        {
            continue;
        }
        if (healer.id == hostile.id || healer.pos.isNearTo(hostile))
        {
            heal += directHeal;
        }
        else if (healer.pos.inRangeTo(hostile, 3))
        {
            heal += rangedHeal;
        }
    }
    return Math.ceil(heal);
}

function getClosestRangeToAny(pos, objects)
{
    var best = undefined;
    if (!pos || !objects)
    {
        return best;
    }
    for (var i = 0; i < objects.length; i++)
    {
        if (!objects[i] || !objects[i].pos)
        {
            continue;
        }
        var range = pos.getRangeTo(objects[i]);
        if (best == undefined || range < best)
        {
            best = range;
        }
    }
    return best;
}

function getTowerDefenseSupportInfo(hostile, creepsInRoom)
{
    var info = {
        focusCount: 0,
        nearbyCount: 0,
        minRange: undefined
    };
    if (!hostile || !creepsInRoom)
    {
        return info;
    }
    for (var i = 0; i < creepsInRoom.length; i++)
    {
        var creep = creepsInRoom[i];
        if (!isTowerDefenseCreep(creep) || !creep.pos || creep.pos.roomName != hostile.pos.roomName)
        {
            continue;
        }
        var range = creep.pos.getRangeTo(hostile);
        if (info.minRange == undefined || range < info.minRange)
        {
            info.minRange = range;
        }
        if (range <= 3)
        {
            info.nearbyCount++;
        }
        if (creep.memory
            && creep.memory.defenseTarget == hostile.id
            && creep.memory.defenseTargetTick == Game.time)
        {
            info.focusCount++;
        }
    }
    return info;
}

function chooseTowerFocusTarget(room, hostiles, activeTowers, creepsInRoom)
{
    if (!hostiles || hostiles.length == 0 || !activeTowers || activeTowers.length == 0)
    {
        return undefined;
    }
    var best = undefined;
    var spawns = room.find(FIND_MY_SPAWNS);
    var coreObjects = spawns.slice();
    if (room.storage)
    {
        coreObjects.push(room.storage);
    }
    if (room.terminal)
    {
        coreObjects.push(room.terminal);
    }

    for (var i = 0; i < hostiles.length; i++)
    {
        var hostile = hostiles[i];
        var estimatedDamage = estimateHostileTowerDamage(hostile, activeTowers);
        var estimatedSingleDamage = estimateBestSingleTowerDamage(hostile, activeTowers);
        var estimatedHeal = estimateHostileHealing(hostile, hostiles);
        var netDamage = Math.max(0, estimatedDamage - estimatedHeal);
        var singleNetDamage = Math.max(0, estimatedSingleDamage - estimatedHeal);
        var healParts = getActivePartCount(hostile, HEAL);
        var workParts = getActivePartCount(hostile, WORK);
        var attackParts = getActivePartCount(hostile, ATTACK);
        var rangedParts = getActivePartCount(hostile, RANGED_ATTACK);
        var claimParts = getActivePartCount(hostile, CLAIM);
        var woundedHits = Math.max(0, hostile.hitsMax - hostile.hits);
        var threatScore = getTowerHostileThreatScore(hostile);
        var dangerous = threatScore > 0;
        var killable = netDamage >= hostile.hits;
        var triviallyKillableByOneTower = singleNetDamage >= hostile.hits;
        var isPlayer = isPlayerHostileCreep(hostile);
        var closestCoreRange = getClosestRangeToAny(hostile.pos, coreObjects);
        var closestTowerRange = getClosestRangeToAny(hostile.pos, activeTowers);
        var supportInfo = getTowerDefenseSupportInfo(hostile, creepsInRoom);
        var score = 0;

        if (killable)
        {
            score += 200000;
        }
        if (netDamage > 0)
        {
            score += 60000 + netDamage;
        }
        if (isPlayer)
        {
            score += 45000;
        }
        if (healParts > 0 || estimatedHeal > 0)
        {
            score += 35000 + estimatedHeal * 2 + healParts * 1000;
        }
        if (attackParts > 0 || rangedParts > 0)
        {
            score += 30000 + attackParts * 600 + rangedParts * 500;
        }
        if (workParts > 0)
        {
            score += 25000 + workParts * 500;
        }
        if (claimParts > 0)
        {
            score += 15000 + claimParts * 250;
        }
        if (dangerous)
        {
            score += 10000 + threatScore;
        }
        if (woundedHits > 0)
        {
            score += 5000 + woundedHits;
        }
        if (closestCoreRange != undefined)
        {
            score += Math.max(0, 50 - closestCoreRange) * 40;
        }
        if (closestTowerRange != undefined)
        {
            score += Math.max(0, 50 - closestTowerRange) * 15;
        }
        if (supportInfo.focusCount > 0)
        {
            score += 70000 + supportInfo.focusCount * 15000;
        }
        if (supportInfo.nearbyCount > 0 && (dangerous || isPlayer))
        {
            score += 20000 + supportInfo.nearbyCount * 5000;
        }
        if (supportInfo.minRange != undefined)
        {
            score += Math.max(0, 6 - supportInfo.minRange) * 1000;
        }
        score -= Math.floor(hostile.hits / 10);

        var info = {
            hostile: hostile,
            score: score,
            estimatedDamage: estimatedDamage,
            estimatedHeal: estimatedHeal,
            netDamage: netDamage,
            dangerous: dangerous,
            isPlayer: isPlayer,
            hasHeal: healParts > 0,
            woundedHits: woundedHits,
            killable: killable,
            triviallyKillableByOneTower: triviallyKillableByOneTower,
            defenseFocusCount: supportInfo.focusCount,
            defenseSupportRange: supportInfo.minRange
        };
        if (!best || info.score > best.score)
        {
            best = info;
        }
    }
    return best;
}

function shouldUseFocusedTowerFire(targetInfo, hostiles, activeTowers)
{
    if (!targetInfo || !targetInfo.hostile)
    {
        return false;
    }
    if (!activeTowers || activeTowers.length <= 1 || !hostiles || hostiles.length <= 1)
    {
        return true;
    }
    if (targetInfo.hasHeal || targetInfo.estimatedHeal > 0)
    {
        return true;
    }
    if (targetInfo.triviallyKillableByOneTower)
    {
        return false;
    }
    return targetInfo.isPlayer
        || targetInfo.killable
        || targetInfo.woundedHits > 0
        || targetInfo.dangerous;
}

function chooseIndividualTowerTarget(tower, hostiles)
{
    if (!tower || !hostiles || hostiles.length == 0)
    {
        return undefined;
    }
    var dangerousHostiles = [];
    for (var i = 0; i < hostiles.length; i++)
    {
        if (isDangerousTowerHostile(hostiles[i]))
        {
            dangerousHostiles.push(hostiles[i]);
        }
    }
    return tower.pos.findClosestByRange(dangerousHostiles.length > 0 ? dangerousHostiles : hostiles);
}

function isTowerDefenseCreep(creep)
{
    var role = creep && creep.memory ? creep.memory.role : undefined;
    return role == 'defender'
        || role == 'healer'
        || role == 'attacker'
        || role == 'quad'
        || role == 'remoteHealer';
}

function chooseTowerHealTarget(creepsInRoom, hostiles)
{
    if (!creepsInRoom || creepsInRoom.length == 0)
    {
        return undefined;
    }
    var hostilePresent = hostiles && hostiles.length > 0;
    var best = undefined;
    for (var i = 0; i < creepsInRoom.length; i++)
    {
        var creep = creepsInRoom[i];
        if (!creep || creep.hits == undefined || creep.hitsMax == undefined)
        {
            continue;
        }
        var wounded = creep.hits < creep.hitsMax;
        var defenseCreep = isTowerDefenseCreep(creep);
        if (!wounded && (!hostilePresent || !defenseCreep))
        {
            continue;
        }
        var incomingDamage = hostilePresent ? combatMath.estimateIncomingDamage(creep, isNonAllyHostileCreep) : 0;
        var ownHeal = combatMath.directHealPower(creep);
        var projectedHits = combatMath.projectedHits(creep, incomingDamage, ownHeal);
        var criticalThreshold = Math.max(100, Math.floor(creep.hitsMax * TOWER_CRITICAL_HEAL_RATIO));
        var critical = hostilePresent
            && (defenseCreep || projectedHits <= 0)
            && projectedHits < criticalThreshold;
        if (!wounded && !critical)
        {
            continue;
        }
        var deficit = Math.max(0, creep.hitsMax - creep.hits);
        var healNeed = deficit;
        if (critical)
        {
            healNeed = Math.max(healNeed, criticalThreshold - projectedHits);
        }
        healNeed = Math.ceil(Math.max(0, healNeed));
        if (healNeed <= 0)
        {
            continue;
        }
        var score = deficit;
        if (critical)
        {
            score += 80000 + Math.max(0, criticalThreshold - projectedHits) * 5;
        }
        if (defenseCreep)
        {
            score += 25000;
        }
        if (creep.memory && creep.memory.role == 'defender')
        {
            score += 5000;
        }
        if (creep.memory && creep.memory.role == 'healer')
        {
            score += 4000;
        }
        score += incomingDamage;
        var info = {
            target: creep,
            score: score,
            critical: critical,
            healNeed: healNeed,
            projectedHits: projectedHits,
            incomingDamage: incomingDamage
        };
        if (!best || info.score > best.score)
        {
            best = info;
        }
    }
    return best;
}

function shouldHealBeforeTowerAttack(healInfo, attackInfo, hostiles)
{
    if (!healInfo || !healInfo.target || !hostiles || hostiles.length == 0)
    {
        return false;
    }
    if (healInfo.projectedHits <= 0)
    {
        return true;
    }
    if (healInfo.critical)
    {
        return true;
    }
    if (!attackInfo || !attackInfo.hostile)
    {
        return true;
    }
    return !attackInfo.dangerous && !attackInfo.isPlayer;
}

function shouldTowerRepairRampart(tower, rampart, hostiles)
{
    if (!tower || !rampart)
    {
        return false;
    }
    if (hostiles && hostiles.length > 0)
    {
        return false;
    }
    if (rampart.hits < TOWER_RAMPART_EMERGENCY_REPAIR_HITS)
    {
        return isTowerActionReady(tower);
    }
    return getTowerEnergy(tower) >= TOWER_RAMPART_REPAIR_ENERGY_RESERVE;
}

function isTowerMaintenanceTarget(structure)
{
    return structure
        && structure.hits != undefined
        && structure.hitsMax > 0
        // A tower repairs at least 200 per shot; a road scuffed by a few
        // footsteps would waste nearly all of it (and 0.2 CPU per tower).
        && structure.hitsMax - structure.hits >= Math.min(200, Math.floor(structure.hitsMax / 5))
        && structure.structureType != STRUCTURE_WALL
        && structure.structureType != STRUCTURE_RAMPART
        && (structure.my == true
            || structure.structureType == STRUCTURE_ROAD
            || structure.structureType == STRUCTURE_CONTAINER);
}

function getRoomTowerMaintenanceTargets(room)
{
    if (!room || !room.controller || !room.controller.my
        || room.controller.level < TOWER_MAINTENANCE_MIN_RCL)
    {
        return [];
    }
    var cache = getRoomTickCache(room);
    if (cache && cache.towerMaintenanceTargets)
    {
        return cache.towerMaintenanceTargets;
    }
    // Roads and containers are neutral structures, so FIND_MY_STRUCTURES omits
    // the maintenance targets towers are most often expected to repair.
    var targets = room.find(FIND_STRUCTURES, {
        filter: isTowerMaintenanceTarget
    });
    targets.sort(function(a, b) {
        var aRatio = a.hits / a.hitsMax;
        var bRatio = b.hits / b.hitsMax;
        if (aRatio != bRatio)
        {
            return aRatio - bRatio;
        }
        return a.hits - b.hits;
    });
    if (cache)
    {
        cache.towerMaintenanceTargets = targets;
    }
    return targets;
}

function shouldTowerPerformMaintenance(room, tower, maintenanceTarget, hostiles)
{
    if (!room || !room.controller || !room.controller.my
        || room.controller.level < TOWER_MAINTENANCE_MIN_RCL
        || !tower || !maintenanceTarget || (hostiles && hostiles.length > 0))
    {
        return false;
    }
    return getTowerEnergy(tower) >= TOWER_MAINTENANCE_ENERGY_RESERVE;
}

function shouldTowerPerformRampartMaintenance(room, tower, rampart, hostiles)
{
    if (!rampart || rampart.structureType != STRUCTURE_RAMPART)
    {
        return false;
    }
    return shouldTowerPerformMaintenance(room, tower, rampart, hostiles);
}

function updateTowerDefenseMemory(room, summary)
{
    if (!room || !room.memory || !summary)
    {
        return;
    }
    if (summary.hostileCount <= 0 && !summary.healTarget && !summary.repairTarget && !summary.paused)
    {
        delete room.memory.towerDefense;
        return;
    }
    room.memory.towerDefense = {
        tick: Game.time,
        towers: summary.activeTowerCount,
        hostiles: summary.hostileCount,
        action: summary.action || 'none',
        focusFire: summary.focusFire == true,
        attackTarget: summary.attackTarget,
        attackOwner: summary.attackOwner,
        estimatedDamage: summary.estimatedDamage,
        estimatedHeal: summary.estimatedHeal,
        defenseFocusCount: summary.defenseFocusCount,
        defenseSupportRange: summary.defenseSupportRange,
        healTarget: summary.healTarget,
        healCritical: summary.healCritical == true,
        repairTarget: summary.repairTarget,
        repairHits: summary.repairHits,
        paused: summary.paused == true,
        pauseUntil: summary.pauseUntil
    };
}

function hasRunTowerDefenseThisTick(room)
{
    if (!room || typeof global == 'undefined')
    {
        return false;
    }
    if (global.towerDefenseRunTick != Game.time)
    {
        global.towerDefenseRunTick = Game.time;
        global.towerDefenseRunRooms = {};
    }
    if (global.towerDefenseRunRooms[room.name])
    {
        return true;
    }
    global.towerDefenseRunRooms[room.name] = true;
    return false;
}

function runTowerDefense(room, towers, hostiles, decayingRamparts, creepsInRoom, rampartMaintenanceTargets)
{
    var pauseUntil = getTowerPauseUntil(room);
    var summary = {
        activeTowerCount: 0,
        hostileCount: hostiles ? hostiles.length : 0,
        focusFire: false,
        paused: pauseUntil > Game.time,
        pauseUntil: pauseUntil
    };
    if (hasRunTowerDefenseThisTick(room))
    {
        return summary;
    }
    if (!room || !towers || towers.length == 0)
    {
        updateTowerDefenseMemory(room, summary);
        return summary;
    }
    if (summary.paused)
    {
        summary.action = 'paused';
        updateTowerDefenseMemory(room, summary);
        return summary;
    }
    var activeTowers = [];
    for (var i = 0; i < towers.length; i++)
    {
        if (isTowerActionReady(towers[i]))
        {
            activeTowers.push(towers[i]);
        }
    }
    summary.activeTowerCount = activeTowers.length;
    if (activeTowers.length == 0)
    {
        updateTowerDefenseMemory(room, summary);
        return summary;
    }

    var roomCreeps = creepsInRoom || room.find(FIND_MY_CREEPS);
    var attackInfo = chooseTowerFocusTarget(room, hostiles, activeTowers, roomCreeps);
    var useFocusFire = shouldUseFocusedTowerFire(attackInfo, hostiles, activeTowers);
    var healInfo = chooseTowerHealTarget(roomCreeps, hostiles);
    var healBeforeAttack = shouldHealBeforeTowerAttack(healInfo, attackInfo, hostiles);
    var repairTarget = decayingRamparts && decayingRamparts.length > 0 ? decayingRamparts[0] : undefined;
    var rampartMaintenanceTarget = rampartMaintenanceTargets && rampartMaintenanceTargets.length > 0
        ? rampartMaintenanceTargets[0] : undefined;
    var maintenanceTargets = (!hostiles || hostiles.length == 0)
        ? getRoomTowerMaintenanceTargets(room) : [];
    // Each maintaining tower takes the next target instead of all hitting the first.
    var maintenanceIndex = 0;
    var orderedTowers = activeTowers.slice();
    if (healInfo && healInfo.target && (healBeforeAttack || !attackInfo))
    {
        orderedTowers.sort(function(a, b) {
            return getTowerHealPowerAt(b, healInfo.target) - getTowerHealPowerAt(a, healInfo.target);
        });
    }

    for (var t = 0; t < orderedTowers.length; t++)
    {
        var tower = orderedTowers[t];
        var maintenanceTarget = maintenanceTargets[maintenanceIndex];
        if (healBeforeAttack && healInfo && healInfo.target && healInfo.healNeed > 0)
        {
            tower.heal(healInfo.target);
            healInfo.healNeed -= getTowerHealPowerAt(tower, healInfo.target);
            summary.action = 'heal';
            summary.healTarget = healInfo.target.name;
            summary.healCritical = healInfo.critical;
            continue;
        }

        var attackTarget = undefined;
        if (attackInfo && attackInfo.hostile)
        {
            attackTarget = useFocusFire ? attackInfo.hostile : chooseIndividualTowerTarget(tower, hostiles);
        }
        if (attackTarget)
        {
            tower.attack(attackTarget);
            summary.action = 'attack';
            summary.focusFire = useFocusFire;
            summary.attackTarget = attackTarget.id;
            summary.attackOwner = getOwnerName(attackTarget);
            summary.estimatedDamage = Math.ceil(attackInfo.estimatedDamage || 0);
            summary.estimatedHeal = Math.ceil(attackInfo.estimatedHeal || 0);
            summary.defenseFocusCount = attackInfo.defenseFocusCount || 0;
            summary.defenseSupportRange = attackInfo.defenseSupportRange;
            continue;
        }

        if (healInfo && healInfo.target && healInfo.healNeed > 0)
        {
            tower.heal(healInfo.target);
            healInfo.healNeed -= getTowerHealPowerAt(tower, healInfo.target);
            summary.action = 'heal';
            summary.healTarget = healInfo.target.name;
            summary.healCritical = healInfo.critical;
            continue;
        }

        if (shouldTowerRepairRampart(tower, repairTarget, hostiles))
        {
            tower.repair(repairTarget);
            summary.action = 'repairRampart';
            summary.repairTarget = repairTarget.id;
            summary.repairHits = repairTarget.hits;
        }
        else if (shouldTowerPerformRampartMaintenance(
            room, tower, rampartMaintenanceTarget, hostiles))
        {
            tower.repair(rampartMaintenanceTarget);
            summary.action = 'repairRampartMaintenance';
            summary.repairTarget = rampartMaintenanceTarget.id;
            summary.repairHits = rampartMaintenanceTarget.hits;
        }
        else if (shouldTowerPerformMaintenance(room, tower, maintenanceTarget, hostiles))
        {
            maintenanceIndex++;
            tower.repair(maintenanceTarget);
            summary.action = 'repairMaintenance';
            summary.repairTarget = maintenanceTarget.id;
            summary.repairHits = maintenanceTarget.hits;
        }
    }
    updateTowerDefenseMemory(room, summary);
    return summary;
}

function isAutoSafeModeProtectedStructureType(structureType)
{
    return structureType == STRUCTURE_TERMINAL
        || structureType == STRUCTURE_LAB
        || structureType == STRUCTURE_EXTENSION
        || structureType == STRUCTURE_SPAWN
        || structureType == STRUCTURE_STORAGE;
}

function isAutoSafeModeDamageTarget(room, target)
{
    if (!target || !target.pos || target.pos.roomName != room.name)
    {
        return false;
    }
    if (target.my && !target.structureType)
    {
        return true;
    }
    return target.my == true && isAutoSafeModeProtectedStructureType(target.structureType);
}

function getRecentAttackSafeModeThreat(room, hostiles)
{
    if (!room.getEventLog || !hostiles || hostiles.length == 0)
    {
        return undefined;
    }

    var hostileIds = {};
    for (let hostile of hostiles)
    {
        hostileIds[hostile.id] = hostile;
    }

    var events = room.getEventLog();
    for (let event of events)
    {
        if (event.event != EVENT_ATTACK)
        {
            continue;
        }

        var attacker = Game.getObjectById(event.objectId);
        if (!attacker || !hostileIds[attacker.id])
        {
            continue;
        }

        var target = event.data && event.data.targetId ? Game.getObjectById(event.data.targetId) : undefined;
        if (isAutoSafeModeDamageTarget(room, target))
        {
            return {hostile: attacker, reason: 'attackDamage'};
        }
    }

    return undefined;
}

function getAutoSafeModeThreat(room, hostiles)
{
    return getRecentAttackSafeModeThreat(room, hostiles);
}

function triggerAutoSafeMode(room, spawn, hostiles)
{
    if (!hostiles || hostiles.length == 0 || !isAutoSafeModeEnabled(room, spawn))
    {
        return;
    }

    // NPC Invaders / Source Keepers should be handled by towers and normal
    // damage telemetry, but they must not spend an owned room's safe mode.
    var playerHostiles = hostiles.filter(isPlayerHostileCreep);
    if (playerHostiles.length == 0)
    {
        return;
    }

    var threat = getAutoSafeModeThreat(room, playerHostiles);
    if (!threat)
    {
        return;
    }

    room.memory = room.memory || {};
    room.memory.autoSafeModeLastThreat = Game.time;
    room.memory.autoSafeModeLastReason = threat.reason;
    room.memory.autoSafeModeLastHostile = getOwnerName(threat.hostile);

    var controller = room.controller;
    if (!controller || !controller.my || controller.safeMode
        || controller.safeModeAvailable <= 0 || controller.safeModeCooldown > 0)
    {
        room.memory.autoSafeModeLastResult = 'unavailable';
        return;
    }

    if (room.memory.autoSafeModeLastAttempt == Game.time)
    {
        return;
    }
    room.memory.autoSafeModeLastAttempt = Game.time;
    room.memory.autoSafeModeLastReason = threat.reason;
    room.memory.autoSafeModeLastHostile = getOwnerName(threat.hostile);
    room.memory.autoSafeModeLastResult = controller.activateSafeMode();
    if (room.memory.autoSafeModeLastResult == OK)
    {
        room.memory.autoSafeModeLastTriggered = Game.time;
    }
}

function applyRclCreepCountTargets(spawn, sourceCount, containerSetupReady, canSpawnMiner, controllerLinkReady, baseLinkReady, extractorReady, mineralReady, constructionSiteCount)
{
    if (spawn.memory.creepCountMode == undefined)
    {
        spawn.memory.creepCountMode = 'autoByRCL';
    }
    if (spawn.memory.creepCountMode != 'autoByRCL')
    {
        return;
    }
    var rcl = 1;
    if (spawn.room.controller)
    {
        rcl = spawn.room.controller.level;
    }
    var sourceTarget = Math.max(1, sourceCount || 1);
    var useContainerEconomy = rcl >= 2 && containerSetupReady && canSpawnMiner;
    var lorryTarget = useContainerEconomy ? sourceTarget : 0;
    if (rcl == 2 && useContainerEconomy)
    {
        lorryTarget = 1;
    }

    var targetsByRcl = {
        1: {minBuilders: 1, minUpgraders: 1, minRepairers: 0, minCLinkers: 0, minBLinkers: 0, minExtractors: 0},
        2: {minBuilders: 2, minUpgraders: 2, minRepairers: 0, minCLinkers: 0, minBLinkers: 0, minExtractors: 0},
        3: {minBuilders: 2, minUpgraders: 2, minRepairers: 0, minCLinkers: 0, minBLinkers: 0, minExtractors: 0},
        4: {minBuilders: 2, minUpgraders: 2, minRepairers: 0, minCLinkers: 0, minBLinkers: 0, minExtractors: 0},
        5: {minBuilders: 2, minUpgraders: 2, minRepairers: 0, minCLinkers: 1, minBLinkers: 0, minExtractors: 0},
        6: {minBuilders: 1, minUpgraders: 3, minRepairers: 0, minCLinkers: 1, minBLinkers: 0, minExtractors: 1},
        7: {minBuilders: 1, minUpgraders: 3, minRepairers: 0, minCLinkers: 1, minBLinkers: 0, minExtractors: 1},
        8: {minBuilders: 0, minUpgraders: 1, minRepairers: 0, minCLinkers: 0, minBLinkers: 0, minExtractors: 1}
    };
    var baseTargets = targetsByRcl[rcl] || targetsByRcl[8];
    var targets = {
        minBuilders: baseTargets.minBuilders,
        minUpgraders: baseTargets.minUpgraders,
        minRepairers: baseTargets.minRepairers,
        minCLinkers: baseTargets.minCLinkers,
        minBLinkers: baseTargets.minBLinkers,
        minExtractors: baseTargets.minExtractors
    };
    if (!controllerLinkReady)
    {
        targets.minCLinkers = 0;
    }
    if (!baseLinkReady)
    {
        targets.minBLinkers = 0;
    }
    if (!extractorReady || !mineralReady)
    {
        targets.minExtractors = 0;
    }

    if (spawn.memory.economyMode == undefined)
    {
        spawn.memory.economyMode = 'upgradePriority';
    }
    var economyMode = spawn.memory.economyMode;
    if (economyMode == 'upgradePriority')
    {
        targets.minBuilders = Math.min(targets.minBuilders, 1);

        if (rcl >= 8)
        {
            targets.minUpgraders = 1;
        }
        else if (rcl >= 5)
        {
            targets.minUpgraders = Math.max(targets.minUpgraders, 4);
        }
        else if (rcl >= 3)
        {
            targets.minUpgraders = Math.max(targets.minUpgraders, 3);
        }
    }
    else if (economyMode == 'builderPriority')
    {
        if (rcl >= 6)
        {
            // At RCL7+ one full-size builder is enough for manual construction.
            // With no sites, a builder only duplicates the dedicated repairer, so
            // remove the standing builder target until a new site is placed.
            if (rcl >= 7 && (constructionSiteCount || 0) <= 0)
            {
                targets.minBuilders = 0;
            }
            else
            {
                targets.minBuilders = Math.max(targets.minBuilders, rcl >= 7 ? 2 : 3);
            }
            targets.minUpgraders = 1;
            targets.minCLinkers = 0;
            targets.minBLinkers = (baseLinkReady || controllerLinkReady) ? 1 : 0;
        }
        else
        {
            targets.minBuilders = Math.max(targets.minBuilders, 2);
        }
    }

    // RCL7+ has higher-capacity extensions, so routine worker bodies are much
    // larger than at RCL6. Keep a low-headcount economy profile there, then
    // let an explicit per-spawn target override win when needed.
    var rcl7CreepCountPlan = creepCounts.applyRcl7CreepCountTargets(rcl,
    {
        minLorries: lorryTarget,
        minBuilders: targets.minBuilders,
        minUpgraders: targets.minUpgraders,
        minRepairers: targets.minRepairers,
        minCLinkers: targets.minCLinkers,
        minBLinkers: targets.minBLinkers,
        minExtractors: targets.minExtractors
    },
    {
        scale: spawn.memory.rcl7CreepCountScale,
        targets: spawn.memory.rcl7CreepCountTargets
    });
    lorryTarget = rcl7CreepCountPlan.targets.minLorries;
    targets.minBuilders = rcl7CreepCountPlan.targets.minBuilders;
    targets.minUpgraders = rcl7CreepCountPlan.targets.minUpgraders;
    targets.minRepairers = rcl7CreepCountPlan.targets.minRepairers;
    targets.minCLinkers = rcl7CreepCountPlan.targets.minCLinkers;
    targets.minBLinkers = rcl7CreepCountPlan.targets.minBLinkers;
    targets.minExtractors = rcl7CreepCountPlan.targets.minExtractors;

    if (rcl >= 8)
    {
        // Generic RCL7 override memory must not turn the RCL8 upkeep policy
        // back into a standing multi-worker workforce. Combat, collapse
        // recovery, and explicit one-shot requests retain their own paths.
        // RCL8 keeps a second local lorry for Power Spawn/Nuker/terminal
        // logistics while preserving the otherwise low-headcount upkeep profile.
        lorryTarget = useContainerEconomy ? 2 : 0;
        targets.minBuilders = (constructionSiteCount || 0) > 0 ? 1 : 0;
        targets.minUpgraders = 1;
        targets.minRepairers = 0;
        targets.minCLinkers = 0;
        targets.minBLinkers = 0;
        targets.minExtractors = extractorReady && mineralReady ? 1 : 0;
        rcl7CreepCountPlan.targets.minLorries = lorryTarget;
        rcl7CreepCountPlan.targets.minBuilders = targets.minBuilders;
        rcl7CreepCountPlan.targets.minUpgraders = targets.minUpgraders;
        rcl7CreepCountPlan.targets.minRepairers = targets.minRepairers;
        rcl7CreepCountPlan.targets.minCLinkers = targets.minCLinkers;
        rcl7CreepCountPlan.targets.minBLinkers = targets.minBLinkers;
        rcl7CreepCountPlan.targets.minExtractors = targets.minExtractors;
        rcl7CreepCountPlan.overrides = {};
    }

    if (rcl7CreepCountPlan.active)
    {
        spawn.memory.rcl7CreepCountScaleApplied = rcl7CreepCountPlan.scale;
        spawn.memory.rcl7CreepCountTargetsApplied = rcl7CreepCountPlan.targets;
        spawn.memory.rcl7CreepCountOverridesApplied = rcl7CreepCountPlan.overrides;
    }
    else
    {
        delete spawn.memory.rcl7CreepCountScaleApplied;
        delete spawn.memory.rcl7CreepCountTargetsApplied;
        delete spawn.memory.rcl7CreepCountOverridesApplied;
    }

    spawn.memory.minHarvesters = useContainerEconomy ? 0 : sourceTarget;
    spawn.memory.minLorries = lorryTarget;
    spawn.memory.minBuilders = targets.minBuilders;
    spawn.memory.minUpgraders = targets.minUpgraders;
    spawn.memory.minRepairers = targets.minRepairers;
    spawn.memory.minCLinkers = targets.minCLinkers;
    spawn.memory.minBLinkers = targets.minBLinkers;
    spawn.memory.minExtractors = targets.minExtractors;
    spawn.memory.minAttackers = 0;
    spawn.memory.minHealers = 0;
    spawn.room.memory.economyMode = economyMode;
    if (spawn.memory.minLDH_E11S23Source0 == undefined)
    {
        spawn.memory.minLDH_E11S23Source0 = 0;
    }
    remoteMining.updateDefaultRemoteLorryAutoTarget(spawn);
    spawn.memory.creepCountRCL = rcl;
    spawn.memory.creepCountEconomyMode = economyMode;
    spawn.memory.creepCountContainerReady = containerSetupReady;
    spawn.memory.creepCountCanSpawnMiner = canSpawnMiner;
    spawn.memory.creepCountControllerLinkReady = controllerLinkReady == true;
    spawn.memory.creepCountBaseLinkReady = baseLinkReady == true;
    spawn.memory.creepCountExtractorReady = extractorReady == true;
    spawn.memory.creepCountMineralReady = mineralReady == true;
}

function normalizeQuadBoostMode(value)
{
    if (value === true)
    {
        return 'required';
    }
    if (value === false)
    {
        return 'never';
    }
    if (typeof value != 'string')
    {
        return 'auto';
    }
    var mode = value.toLowerCase();
    if (mode == 'required' || mode == 'strict' || mode == 'boosted')
    {
        return 'required';
    }
    if (mode == 'never' || mode == 'none' || mode == 'unboosted')
    {
        return 'never';
    }
    if (mode == 'fastest')
    {
        return 'fastest';
    }
    return 'auto';
}

function getPositiveInt(value, fallback, min, max)
{
    var parsed = value;
    if (typeof parsed == 'string')
    {
        parsed = parseInt(parsed, 10);
    }
    if (typeof parsed != 'number' || !isFinite(parsed) || isNaN(parsed))
    {
        parsed = fallback;
    }
    parsed = Math.floor(parsed);
    if (min != undefined && parsed < min)
    {
        parsed = min;
    }
    if (max != undefined && parsed > max)
    {
        parsed = max;
    }
    return parsed;
}

function isValidRoomName(roomName)
{
    return typeof roomName == 'string' && /^[WE]\d+[NS]\d+$/.test(roomName);
}

function normalizeRoomNameList(value)
{
    var raw = [];
    if (typeof value == 'string')
    {
        raw = value.split(',');
    }
    else if (Array.isArray(value))
    {
        raw = value;
    }
    var rooms = [];
    for (var i = 0; i < raw.length; i++)
    {
        var roomName = raw[i];
        if (typeof roomName == 'string')
        {
            roomName = roomName.trim();
        }
        if (isValidRoomName(roomName) && rooms.indexOf(roomName) < 0)
        {
            rooms.push(roomName);
        }
    }
    return rooms;
}

function normalizeQuadRallyPos(value, fallbackRoom)
{
    if (typeof value == 'string')
    {
        var parts = value.split(':');
        if (parts.length == 3)
        {
            value = {roomName: parts[0], x: parseInt(parts[1], 10), y: parseInt(parts[2], 10)};
        }
    }
    if (!value || typeof value != 'object')
    {
        return undefined;
    }
    var roomName = value.roomName || value.room || fallbackRoom;
    var x = parseInt(value.x, 10);
    var y = parseInt(value.y, 10);
    if (!isValidRoomName(roomName) || isNaN(x) || isNaN(y) || x < 1 || x > 47 || y < 1 || y > 47)
    {
        return undefined;
    }
    return roomName + ':' + x + ':' + y;
}

function getGlobalQuadSourceRoom(rawRequest, fallbackSpawn)
{
    var memoryRequest = typeof rawRequest == 'object' ? rawRequest : {};
    if (isValidRoomName(Memory.quadSpawnRoom))
    {
        return Memory.quadSpawnRoom;
    }
    if (isValidRoomName(memoryRequest.sourceRoom))
    {
        return memoryRequest.sourceRoom;
    }
    if (isValidRoomName(memoryRequest.retreatRoom))
    {
        return memoryRequest.retreatRoom;
    }
    var spawnNames = Object.keys(Game.spawns || {}).sort();
    if (spawnNames.length > 0 && Game.spawns[spawnNames[0]])
    {
        return Game.spawns[spawnNames[0]].room.name;
    }
    return fallbackSpawn.room.name;
}

function getQuadRequestSource(spawn)
{
    if (spawn.memory && spawn.memory.spawnQuad)
    {
        return {memory: spawn.memory, raw: spawn.memory.spawnQuad, sourceRoom: spawn.room.name};
    }
    if (spawn.room.memory && spawn.room.memory.spawnQuad)
    {
        return {memory: spawn.room.memory, raw: spawn.room.memory.spawnQuad, sourceRoom: spawn.room.name};
    }
    if (Memory.spawnQuad)
    {
        return {memory: Memory, raw: Memory.spawnQuad, sourceRoom: getGlobalQuadSourceRoom(Memory.spawnQuad, spawn)};
    }
    if (Memory.quadSpawn)
    {
        return {memory: Memory, raw: Memory.quadSpawn, sourceRoom: getGlobalQuadSourceRoom(Memory.quadSpawn, spawn)};
    }
    for (var spawnName in Game.spawns)
    {
        var otherSpawn = Game.spawns[spawnName];
        if (otherSpawn && otherSpawn.memory && otherSpawn.memory.spawnQuad)
        {
            return {memory: otherSpawn.memory, raw: otherSpawn.memory.spawnQuad, sourceRoom: otherSpawn.room.name};
        }
    }
    return undefined;
}

function getQuadSpawnRequest(spawn)
{
    var source = getQuadRequestSource(spawn);
    if (!source || source.raw === false)
    {
        return undefined;
    }
    var sourceMemory = source.memory || {};
    var rawRequest = source.raw;
    var memoryRequest = typeof rawRequest == 'object' ? rawRequest : {};
    if (memoryRequest.enabled === false)
    {
        return undefined;
    }

    var request = {
        squad: sourceMemory.quadSquad || 'quad1',
        targetRoom: sourceMemory.quadTargetRoom || sourceMemory.attackRoom,
        targetFlag: sourceMemory.quadTargetFlag || 'QuadTarget',
        retreatRoom: sourceMemory.quadRetreatRoom || source.sourceRoom,
        sourceRoom: source.sourceRoom,
        distributed: sourceMemory.quadDistributed !== false,
        maxRange: getPositiveInt(sourceMemory.quadSpawnMaxRange, DEFAULT_DISTRIBUTED_QUAD_MAX_RANGE, 0, 10),
        maxRooms: getPositiveInt(sourceMemory.quadSpawnMaxRooms, DEFAULT_DISTRIBUTED_QUAD_MAX_ROOMS, 1, 4),
        boostMode: normalizeQuadBoostMode(sourceMemory.quadBoosted == true ? 'required' : (sourceMemory.quadBoosted == false ? 'never' : sourceMemory.quadBoostMode)),
        autoRally: sourceMemory.quadAutoRally !== false
    };

    if (typeof rawRequest == 'string')
    {
        request.squad = rawRequest;
    }
    else if (typeof rawRequest == 'object')
    {
        request.squad = memoryRequest.squad || memoryRequest.squadId || request.squad;
        request.targetRoom = memoryRequest.targetRoom || memoryRequest.target || request.targetRoom;
        request.targetFlag = memoryRequest.targetFlag || request.targetFlag;
        request.retreatRoom = memoryRequest.retreatRoom || request.retreatRoom;
        request.distributed = memoryRequest.distributed !== false && memoryRequest.localOnly !== true;
        request.maxRange = getPositiveInt(memoryRequest.maxRange, request.maxRange, 0, 10);
        request.maxRooms = getPositiveInt(memoryRequest.maxRooms || memoryRequest.roomsMax, request.maxRooms, 1, 4);
        if (memoryRequest.boosted != undefined)
        {
            request.boostMode = normalizeQuadBoostMode(memoryRequest.boosted == true ? 'required' : 'never');
        }
        request.boostMode = normalizeQuadBoostMode(memoryRequest.boostMode || memoryRequest.boost || request.boostMode);
        request.autoRally = memoryRequest.autoRally !== false && memoryRequest.manualRally !== true;
        request.spawnRooms = normalizeRoomNameList(memoryRequest.spawnRooms || memoryRequest.rooms || sourceMemory.quadSpawnRooms);
        request.rallyFlag = memoryRequest.rallyFlag || sourceMemory.quadRallyFlag;
        request.rallyRoom = memoryRequest.rallyRoom || sourceMemory.quadRallyRoom;
        request.rallyPos = normalizeQuadRallyPos(memoryRequest.rallyPos || sourceMemory.quadRallyPos, request.rallyRoom || request.retreatRoom || source.sourceRoom);
    }
    else
    {
        request.spawnRooms = normalizeRoomNameList(sourceMemory.quadSpawnRooms);
        request.rallyFlag = sourceMemory.quadRallyFlag;
        request.rallyRoom = sourceMemory.quadRallyRoom;
        request.rallyPos = normalizeQuadRallyPos(sourceMemory.quadRallyPos, request.rallyRoom || request.retreatRoom || source.sourceRoom);
    }

    request.manualRallyRoom = isValidRoomName(request.rallyRoom);
    if (!request.rallyRoom)
    {
        request.rallyRoom = request.retreatRoom || request.sourceRoom;
    }
    if (!request.distributed && spawn.room.name != request.sourceRoom)
    {
        return undefined;
    }
    return request;
}

function getQuadSquadName(memory)
{
    return memory.squad || memory.squadId || 'default';
}

function makeCreepName(spawn, roleName)
{
    return roleName + '-' + spawn.name + '-' + Game.time.toString();
}

function resetMainLoopCacheIfNeeded()
{
    if (typeof global == 'undefined')
    {
        return undefined;
    }
    if (global.mainLoopCacheTick != Game.time)
    {
        global.mainLoopCacheTick = Game.time;
        global.mainLoopCache = {
            spawnNames: undefined,
            roomSpawns: {},
            rooms: {},
            globalLiveRoleCounts: undefined
        };
    }
    return global.mainLoopCache;
}

function getMainLoopCache()
{
    return resetMainLoopCacheIfNeeded();
}

function getRoomTickCache(room)
{
    var cache = getMainLoopCache();
    if (!cache || !room)
    {
        return undefined;
    }
    var roomName = room.name;
    cache.rooms[roomName] = cache.rooms[roomName] || {};
    return cache.rooms[roomName];
}

function getAllSpawnNamesSorted()
{
    var cache = getMainLoopCache();
    if (cache)
    {
        if (!cache.spawnNames)
        {
            cache.spawnNames = Object.keys(Game.spawns || {}).sort();
        }
        return cache.spawnNames.slice();
    }
    return Object.keys(Game.spawns || {}).sort();
}

function getRoomSpawns(room)
{
    var spawns = [];
    if (!room)
    {
        return spawns;
    }
    var cache = getMainLoopCache();
    if (cache && cache.roomSpawns[room.name])
    {
        return cache.roomSpawns[room.name].slice();
    }
    var spawnNames = getAllSpawnNamesSorted();
    for (var i = 0; i < spawnNames.length; i++)
    {
        var spawn = Game.spawns[spawnNames[i]];
        if (spawn && spawn.room && spawn.room.name == room.name)
        {
            spawns.push(spawn);
        }
    }
    if (cache)
    {
        cache.roomSpawns[room.name] = spawns;
        return spawns.slice();
    }
    return spawns;
}

function getRoomPrimarySpawn(room)
{
    var spawns = getRoomSpawns(room);
    return spawns.length > 0 ? spawns[0] : undefined;
}

function isPrimaryRoomSpawn(spawn)
{
    var primary = getRoomPrimarySpawn(spawn ? spawn.room : undefined);
    return !primary || primary.name == spawn.name;
}

function getRoomMyCreeps(room)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.myCreeps)
    {
        return cache.myCreeps;
    }
    var creeps = room ? room.find(FIND_MY_CREEPS) : [];
    if (cache)
    {
        cache.myCreeps = creeps;
    }
    return creeps;
}

function getRoomHostileInfo(room)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.hostileInfo)
    {
        return cache.hostileInfo;
    }
    var hostiles = room ? room.find(FIND_HOSTILE_CREEPS,
    {
        filter: isNonAllyHostileCreep
    }) : [];
    var playerHostiles = [];
    for (var i = 0; i < hostiles.length; i++)
    {
        if (isPlayerHostileCreep(hostiles[i]))
        {
            playerHostiles.push(hostiles[i]);
        }
    }
    var info = {
        hostiles: hostiles,
        playerHostiles: playerHostiles
    };
    if (cache)
    {
        cache.hostileInfo = info;
    }
    return info;
}

function getRoomOwnedRamparts(room)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.ownedRamparts)
    {
        return cache.ownedRamparts;
    }
    var ramparts = room ? room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType == STRUCTURE_RAMPART
    }) : [];
    ramparts.sort((a, b) => a.hits - b.hits);
    if (cache)
    {
        cache.ownedRamparts = ramparts;
    }
    return ramparts;
}

function getRoomLiveRoleCounts(room, creepsInRoom)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.liveRoleCounts)
    {
        return cache.liveRoleCounts;
    }
    var counts = {};
    var creeps = creepsInRoom || getRoomMyCreeps(room);
    for (var i = 0; i < creeps.length; i++)
    {
        var creep = creeps[i];
        var role = creep && creep.memory ? creep.memory.role : undefined;
        if (role != undefined)
        {
            counts[role] = (counts[role] || 0) + 1;
        }
    }
    if (cache)
    {
        cache.liveRoleCounts = counts;
    }
    return counts;
}

// FIND_MY_CREEPS does not reliably include a creep while it is still in a
// spawn's production queue. In a room with multiple spawns, a second idle
// spawn must treat that in-progress creep as fulfilling the room target.
function getRoomSpawningRoleInfo(room, creepsInRoom)
{
    var cache = getRoomTickCache(room);
    if (cache && cache.spawningRoleInfo)
    {
        return cache.spawningRoleInfo;
    }
    var info = {roles: {}, names: {}, memories: {}};
    var liveNames = {};
    var creeps = creepsInRoom || getRoomMyCreeps(room);
    for (var i = 0; i < creeps.length; i++)
    {
        liveNames[creeps[i].name] = true;
    }
    var spawns = getRoomSpawns(room);
    for (var j = 0; j < spawns.length; j++)
    {
        var spawning = spawns[j].spawning;
        var creepName = spawning && spawning.name;
        if (!creepName || liveNames[creepName])
        {
            continue;
        }
        var memory = Memory.creeps && Memory.creeps[creepName];
        var role = memory && memory.role;
        if (role == undefined)
        {
            continue;
        }
        info.roles[role] = (info.roles[role] || 0) + 1;
        info.names[creepName] = role;
        info.memories[creepName] = memory;
    }
    if (cache)
    {
        cache.spawningRoleInfo = info;
    }
    return info;
}

function getGlobalSpawningRoleInfo()
{
    var cache = getMainLoopCache();
    if (cache && cache.globalSpawningRoleInfo)
    {
        return cache.globalSpawningRoleInfo;
    }
    var info = {roles: {}, names: {}};
    var liveNames = {};
    for (var creepName in Game.creeps)
    {
        liveNames[creepName] = true;
    }
    for (var spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        var spawning = spawn && spawn.spawning;
        var queuedName = spawning && spawning.name;
        if (!queuedName || liveNames[queuedName])
        {
            continue;
        }
        var memory = Memory.creeps && Memory.creeps[queuedName];
        var role = memory && memory.role;
        if (role == undefined)
        {
            continue;
        }
        info.roles[role] = (info.roles[role] || 0) + 1;
        info.names[queuedName] = role;
    }
    if (cache)
    {
        cache.globalSpawningRoleInfo = info;
    }
    return info;
}

function countPlannedSpawningRoleOverlap(plannedNames, spawningInfo, role)
{
    var overlap = 0;
    for (var creepName in plannedNames)
    {
        if (plannedNames[creepName] == role && spawningInfo.names[creepName] == role)
        {
            overlap++;
        }
    }
    return overlap;
}

function getGlobalLiveRoleCounts()
{
    var cache = getMainLoopCache();
    if (cache && cache.globalLiveRoleCounts)
    {
        return cache.globalLiveRoleCounts;
    }
    var counts = {};
    for (var name in Game.creeps)
    {
        var creep = Game.creeps[name];
        var role = creep && creep.memory ? creep.memory.role : undefined;
        if (role != undefined)
        {
            counts[role] = (counts[role] || 0) + 1;
        }
    }
    if (cache)
    {
        cache.globalLiveRoleCounts = counts;
    }
    return counts;
}

function syncSameRoomSpawnMemory(spawn)
{
    if (!spawn || !spawn.room || !spawn.memory)
    {
        return;
    }
    var spawns = getRoomSpawns(spawn.room);
    var spawnNames = [];
    for (var i = 0; i < spawns.length; i++)
    {
        spawnNames.push(spawns[i].name);
    }
    spawn.room.memory.spawnNames = spawnNames;
    spawn.room.memory.spawnCount = spawns.length;
    spawn.memory.roomSpawnCount = spawns.length;
    var primary = spawns.length > 0 ? spawns[0] : spawn;
    spawn.memory.roomPrimarySpawn = primary.name;
    if (primary.name == spawn.name || !primary.memory)
    {
        return;
    }

    // Counts and economy mode are room-level decisions. A new RCL7 spawn in the
    // same room should help the primary spawn's plan, not create its own target
    // profile and over-spawn the room. Do not copy one-shot requests here.
    var sharedKeys = [
        'creepCountMode',
        'economyMode',
        'rcl7CreepCountScale',
        'rcl7CreepCountTargets',
        'rampartTargetHits',
        'multiSpawnMinEnergy',
        'minHarvesters',
        'minLorries',
        'minBuilders',
        'minUpgraders',
        'minRepairers',
        'minCLinkers',
        'minBLinkers',
        'minExtractors',
        'minAttackers',
        'minHealers',
        'minLDH_E11S23Source0',
        'minRemoteLorriesE9S17',
        'remoteLorriesE9S17AutoTarget',
        'remoteReservations',
        'reserveRooms',
        'reserveAvoidRooms',
        'remoteE9S17AvoidRooms',
        'remoteE9S17Reserved'
    ];
    for (var k = 0; k < sharedKeys.length; k++)
    {
        var key = sharedKeys[k];
        if (primary.memory[key] != undefined)
        {
            spawn.memory[key] = primary.memory[key];
        }
        else
        {
            delete spawn.memory[key];
        }
    }
}

function getSharedRoomSpawnEnergy(spawn)
{
    var preferredEnergy = spawn.room.energyCapacityAvailable;
    if (!spawn.room.controller || spawn.room.controller.level < 7)
    {
        return preferredEnergy;
    }
    var spawns = getRoomSpawns(spawn.room);
    if (spawns.length < 2)
    {
        return preferredEnergy;
    }
    if (spawn.room.energyAvailable >= preferredEnergy)
    {
        return preferredEnergy;
    }
    var minEnergy = spawn.memory.multiSpawnMinEnergy;
    if (typeof minEnergy != 'number' || !isFinite(minEnergy) || minEnergy < 0)
    {
        // Larger routine bodies keep the RCL7+ low-headcount policy real: fewer
        // creeps means fewer role runs, path searches, and traffic interactions.
        // A room may explicitly opt in to faster partial-energy spawns by setting
        // multiSpawnMinEnergy below capacity, but the default waits for capacity.
        minEnergy = preferredEnergy;
    }
    minEnergy = Math.min(Math.floor(minEnergy), preferredEnergy);
    if (spawn.room.energyAvailable >= minEnergy)
    {
        return spawn.room.energyAvailable;
    }
    return preferredEnergy;
}

function resetSpawnPlanContextIfNeeded()
{
    if (typeof global == 'undefined')
    {
        return;
    }
    if (global.roomSpawnPlanTick != Game.time)
    {
        global.roomSpawnPlanTick = Game.time;
        global.roomSpawnPlans = {};
        global.globalSpawnPlannedRoles = {};
        global.globalSpawnPlannedNames = {};
    }
}

function getRoomSpawnPlanContext(room)
{
    resetSpawnPlanContextIfNeeded();
    if (typeof global == 'undefined')
    {
        return {
            roles: {},
            creepNames: {},
            minerSources: {},
            slinkerSources: {},
            mineralContainerLorries: {},
            remoteHarvesters: {},
            remoteLorries: {}
        };
    }
    global.roomSpawnPlans = global.roomSpawnPlans || {};
    var roomName = room ? room.name : 'unknown';
    if (!global.roomSpawnPlans[roomName])
    {
        global.roomSpawnPlans[roomName] = {
            roles: {},
            creepNames: {},
            minerSources: {},
            slinkerSources: {},
            mineralContainerLorries: {},
            remoteHarvesters: {},
            remoteLorries: {}
        };
    }
    return global.roomSpawnPlans[roomName];
}

function countRoomRoleWithPlanned(room, creepsInRoom, role)
{
    var liveCounts = getRoomLiveRoleCounts(room, creepsInRoom);
    var live = liveCounts[role] || 0;
    var context = getRoomSpawnPlanContext(room);
    var spawningInfo = getRoomSpawningRoleInfo(room, creepsInRoom);
    var spawning = spawningInfo.roles[role] || 0;
    var planned = context.roles[role] || 0;
    // A spawn created earlier in this tick can be visible both in the planner
    // and through spawn.spawning. Reserve it once, not twice.
    var overlap = countPlannedSpawningRoleOverlap(context.creepNames, spawningInfo, role);
    return live + spawning + planned - overlap;
}

function countGlobalRoleWithPlanned(role)
{
    resetSpawnPlanContextIfNeeded();
    var liveCounts = getGlobalLiveRoleCounts();
    var live = liveCounts[role] || 0;
    var planned = 0;
    var plannedNames = {};
    if (typeof global != 'undefined' && global.globalSpawnPlannedRoles)
    {
        planned = global.globalSpawnPlannedRoles[role] || 0;
        plannedNames = global.globalSpawnPlannedNames || {};
    }
    var spawningInfo = getGlobalSpawningRoleInfo();
    var spawning = spawningInfo.roles[role] || 0;
    var overlap = countPlannedSpawningRoleOverlap(plannedNames, spawningInfo, role);
    return live + spawning + planned - overlap;
}

function getRemoteSpawnPlanKey(targetRoom, sourceId)
{
    return (targetRoom || 'unknown') + ':' + (sourceId || 'unknown');
}

function getPlannedRemoteSpawnCount(room, role, targetRoom, sourceId)
{
    var context = getRoomSpawnPlanContext(room);
    var key = getRemoteSpawnPlanKey(targetRoom, sourceId);
    if (role == 'longDistanceHarvester')
    {
        return context.remoteHarvesters[key] || 0;
    }
    if (role == 'remoteLorry')
    {
        return context.remoteLorries[key] || 0;
    }
    return 0;
}

function hasPlannedMinerForSource(room, sourceId)
{
    var context = getRoomSpawnPlanContext(room);
    return context.minerSources[sourceId] == true;
}

function hasPlannedSlinkerForSource(room, sourceId)
{
    var context = getRoomSpawnPlanContext(room);
    return context.slinkerSources[sourceId] == true;
}

function hasSlinkerForSource(creepsInRoom, sourceId)
{
    return _.some(creepsInRoom, (creep) => creep.memory.role == 'Slinker'
        && creep.memory.sourceId == sourceId);
}

function hasSpawningCreepForSource(room, creepsInRoom, role, sourceId)
{
    var spawningInfo = getRoomSpawningRoleInfo(room, creepsInRoom);
    for (var creepName in spawningInfo.names)
    {
        var memory = spawningInfo.memories[creepName];
        if (spawningInfo.names[creepName] == role && memory && memory.sourceId == sourceId)
        {
            return true;
        }
    }
    return false;
}

function hasSpawningMineralLorryForContainer(room, creepsInRoom, containerId)
{
    var spawningInfo = getRoomSpawningRoleInfo(room, creepsInRoom);
    for (var creepName in spawningInfo.names)
    {
        var memory = spawningInfo.memories[creepName];
        if (spawningInfo.names[creepName] == 'mineralLorry'
            && memory && memory.sourceContainerId == containerId)
        {
            return true;
        }
    }
    return false;
}

function hasSpawningMineralLorryForSpecialStructure(room, creepsInRoom, structureId)
{
    var spawningInfo = getRoomSpawningRoleInfo(room, creepsInRoom);
    for (var creepName in spawningInfo.names)
    {
        var memory = spawningInfo.memories[creepName];
        if (spawningInfo.names[creepName] == 'mineralLorry'
            && memory && memory.specialStructureId == structureId)
        {
            return true;
        }
    }
    return false;
}

function findUnassignedSlinkerSourceId(room, sources, whiteFlagSourceIds, creepsInRoom)
{
    for (let source of sources)
    {
        if (whiteFlagSourceIds[source.id]
            && !hasSlinkerForSource(creepsInRoom, source.id)
            && !hasSpawningCreepForSource(room, creepsInRoom, 'Slinker', source.id)
            && !hasPlannedSlinkerForSource(room, source.id))
        {
            return source.id;
        }
    }
    return undefined;
}

function hasPlannedMineralLorryForContainer(room, containerId)
{
    var context = getRoomSpawnPlanContext(room);
    return context.mineralContainerLorries[containerId] == true;
}

function hasPlannedRoomRoleSpawn(room, role)
{
    var context = getRoomSpawnPlanContext(room);
    return (context.roles[role] || 0) > 0;
}

function recordSpawnAttempt(spawn, result, role, details)
{
    if (result < 0)
    {
        return result;
    }
    var context = getRoomSpawnPlanContext(spawn.room);
    context.roles[role] = (context.roles[role] || 0) + 1;
    if (typeof result == 'string')
    {
        context.creepNames[result] = role;
    }
    if (typeof global != 'undefined')
    {
        global.globalSpawnPlannedRoles = global.globalSpawnPlannedRoles || {};
        global.globalSpawnPlannedRoles[role] = (global.globalSpawnPlannedRoles[role] || 0) + 1;
        if (typeof result == 'string')
        {
            global.globalSpawnPlannedNames = global.globalSpawnPlannedNames || {};
            global.globalSpawnPlannedNames[result] = role;
        }
    }
    details = details || {};
    if (role == 'miner' && details.sourceId != undefined)
    {
        context.minerSources[details.sourceId] = true;
    }
    if (role == 'Slinker' && details.sourceId != undefined)
    {
        context.slinkerSources[details.sourceId] = true;
    }
    if (role == 'mineralLorry' && details.containerId != undefined)
    {
        context.mineralContainerLorries[details.containerId] = true;
    }
    if (details.remoteRoom != undefined && details.sourceId != undefined)
    {
        let key = getRemoteSpawnPlanKey(details.remoteRoom, details.sourceId);
        if (role == 'longDistanceHarvester')
        {
            context.remoteHarvesters[key] = (context.remoteHarvesters[key] || 0) + 1;
        }
        else if (role == 'remoteLorry')
        {
            context.remoteLorries[key] = (context.remoteLorries[key] || 0) + 1;
        }
    }
    spawn.memory.lastSpawnRole = role;
    spawn.memory.lastSpawnResult = result;
    spawn.memory.lastSpawnTick = Game.time;
    return result;
}

function cleanupObsoleteSpawnMemory(spawn)
{
    for (let key in spawn.memory)
    {
        if (key.indexOf('minLDH') == 0 && key != 'minLDH_E11S23Source0')
        {
            delete spawn.memory[key];
        }
        else if (key.indexOf('minRemoteLorries') == 0 && key != 'minRemoteLorriesE9S17')
        {
            delete spawn.memory[key];
        }
    }
}

function getQuadSlotStatus(squad)
{
    var status = [false, false, false, false];
    Memory.creeps = Memory.creeps || {};
    for (var name in Memory.creeps)
    {
        var memory = Memory.creeps[name];
        if (memory && memory.role == 'quad' && getQuadSquadName(memory) == squad)
        {
            var slot = memory.slot;
            if (typeof slot == 'number' && slot >= 0 && slot < 4)
            {
                status[slot] = true;
            }
        }
    }
    return status;
}

function countLiveQuadMembers(squad)
{
    var count = 0;
    for (var name in Game.creeps)
    {
        var creep = Game.creeps[name];
        if (creep.memory && creep.memory.role == 'quad'
            && getQuadSquadName(creep.memory) == squad)
        {
            count++;
        }
    }
    return count;
}

function getMissingQuadSlots(squad)
{
    var missing = [];
    var status = getQuadSlotStatus(squad);
    for (var slot = 0; slot < 4; slot++)
    {
        if (!status[slot])
        {
            missing.push(slot);
        }
    }
    return missing;
}

function getMissingQuadSlot(squad)
{
    var missing = getMissingQuadSlots(squad);
    return missing.length > 0 ? missing[0] : undefined;
}

function isQuadFormed(request)
{
    if (!request)
    {
        return true;
    }
    if (countLiveQuadMembers(request.squad) < 4)
    {
        return false;
    }
    return !!(Memory.quads && Memory.quads[request.squad] && Memory.quads[request.squad].formed);
}

function getQuadMemberBundleCount(energy)
{
    var nParts = Math.floor(energy / QUAD_MEMBER_BUNDLE_COST);
    if (nParts > 8)
    {
        nParts = 8;
    }
    return nParts;
}

function getQuadMemberBoostPartCount(energy, part)
{
    var nParts = getQuadMemberBundleCount(energy);
    // Full members add a ninth TOUGH part to complete the 25/25 body split.
    if (nParts == 8 && energy >= QUAD_MEMBER_FULL_BODY_COST && part == TOUGH)
    {
        return nParts + 1;
    }
    return nParts;
}

function getResourceAvailableForBoost(room, resourceType, boostLab)
{
    var amount = 0;
    if (room.terminal)
    {
        amount += room.terminal.store.getUsedCapacity(resourceType);
    }
    if (room.storage)
    {
        amount += room.storage.store.getUsedCapacity(resourceType);
    }
    if (boostLab)
    {
        amount += boostLab.store.getUsedCapacity(resourceType);
    }
    return amount;
}

function getQuadBoostReadiness(spawn, request)
{
    var nParts = getQuadMemberBundleCount(spawn.room.energyCapacityAvailable);
    var readiness = {ready: false, nParts: nParts, missing: []};
    if (nParts < 1)
    {
        readiness.missing.push('energy capacity');
        return readiness;
    }
    if (Memory.combatBoostingEnabled === false)
    {
        readiness.missing.push('boosting disabled');
        return readiness;
    }
    if (!spawn.room.terminal)
    {
        readiness.missing.push('terminal');
        return readiness;
    }
    for (let boost of COMBAT_T3_BOOSTS)
    {
        let requiredPartCount = getQuadMemberBoostPartCount(spawn.room.energyCapacityAvailable, boost.part);
        let requiredMineral = requiredPartCount * QUAD_BOOST_MINERAL_PER_PART;
        let requiredEnergy = requiredPartCount * QUAD_BOOST_ENERGY_PER_PART;
        let lab = getBoostLab(spawn.room, boost);
        if (!lab)
        {
            readiness.missing.push('lab ' + boost.resource);
            continue;
        }
        if (lab.mineralType != undefined
            && lab.mineralType != boost.resource
            && lab.store.getUsedCapacity(boost.resource) == 0)
        {
            readiness.missing.push('wrong lab mineral ' + lab.mineralType);
            continue;
        }
        let available = getResourceAvailableForBoost(spawn.room, boost.resource, lab);
        if (available < requiredMineral)
        {
            readiness.missing.push(boost.resource + ':' + available + '/' + requiredMineral);
        }
        let labEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY);
        if (labEnergy < requiredEnergy)
        {
            readiness.missing.push('lab energy ' + boost.resource + ':' + labEnergy + '/' + requiredEnergy);
        }
    }
    readiness.ready = readiness.missing.length == 0;
    return readiness;
}

function getQuadSpawnReferenceRoom(request)
{
    if (request.rallyPos)
    {
        var parts = request.rallyPos.split(':');
        if (parts.length == 3 && isValidRoomName(parts[0]))
        {
            return parts[0];
        }
    }
    if (isValidRoomName(request.rallyRoom))
    {
        return request.rallyRoom;
    }
    if (isValidRoomName(request.targetRoom))
    {
        return request.targetRoom;
    }
    if (isValidRoomName(request.sourceRoom))
    {
        return request.sourceRoom;
    }
    return undefined;
}

function isRoomAllowedForQuadRequest(roomName, request)
{
    if (request.spawnRooms && request.spawnRooms.length > 0)
    {
        return request.spawnRooms.indexOf(roomName) >= 0;
    }
    var referenceRoom = getQuadSpawnReferenceRoom(request);
    if (!isValidRoomName(referenceRoom))
    {
        return true;
    }
    return Game.map.getRoomLinearDistance(roomName, referenceRoom) <= request.maxRange;
}

function getQuadSpawnCandidates(request)
{
    var candidates = [];
    var usedRooms = {};
    var referenceRoom = getQuadSpawnReferenceRoom(request);
    for (var spawnName in Game.spawns)
    {
        var candidateSpawn = Game.spawns[spawnName];
        if (!candidateSpawn || candidateSpawn.spawning || !candidateSpawn.room
            || !candidateSpawn.room.controller || !candidateSpawn.room.controller.my)
        {
            continue;
        }
        if (usedRooms[candidateSpawn.room.name])
        {
            continue;
        }
        if (!request.distributed && candidateSpawn.room.name != request.sourceRoom)
        {
            continue;
        }
        if (!isRoomAllowedForQuadRequest(candidateSpawn.room.name, request))
        {
            continue;
        }
        if (candidateSpawn.room.energyCapacityAvailable < QUAD_MEMBER_BUNDLE_COST)
        {
            candidateSpawn.memory.spawnQuadError = 'not enough energy capacity for quad member';
            continue;
        }

        var boostReadiness = getQuadBoostReadiness(candidateSpawn, request);
        if (request.boostMode == 'required' && !boostReadiness.ready)
        {
            candidateSpawn.memory.spawnQuadError = 'missing boost resources: ' + boostReadiness.missing.join(',');
            continue;
        }
        var memberBoostMode = 'never';
        if (request.boostMode == 'required' || (request.boostMode == 'auto' && boostReadiness.ready))
        {
            memberBoostMode = 'required';
        }
        var distance = isValidRoomName(referenceRoom)
            ? Game.map.getRoomLinearDistance(candidateSpawn.room.name, referenceRoom)
            : 0;
        candidates.push({
            spawnName: spawnName,
            roomName: candidateSpawn.room.name,
            distance: distance,
            nParts: getQuadMemberBundleCount(candidateSpawn.room.energyCapacityAvailable),
            boostReady: boostReadiness.ready,
            boostMissing: boostReadiness.missing,
            boostMode: memberBoostMode
        });
        usedRooms[candidateSpawn.room.name] = true;
    }

    candidates.sort(function(a, b)
    {
        if ((request.boostMode == 'auto' || request.boostMode == 'required')
            && a.boostReady != b.boostReady)
        {
            return a.boostReady ? -1 : 1;
        }
        if (request.boostMode == 'fastest')
        {
            if (a.distance != b.distance)
            {
                return a.distance - b.distance;
            }
            if (a.nParts != b.nParts)
            {
                return b.nParts - a.nParts;
            }
        }
        else
        {
            if (a.nParts != b.nParts)
            {
                return b.nParts - a.nParts;
            }
            if (a.distance != b.distance)
            {
                return a.distance - b.distance;
            }
        }
        return a.spawnName < b.spawnName ? -1 : 1;
    });

    return candidates.slice(0, request.maxRooms);
}

function getQuadCandidateForSpawn(candidates, spawnName)
{
    for (var i = 0; i < candidates.length; i++)
    {
        if (candidates[i].spawnName == spawnName)
        {
            return {candidate: candidates[i], index: i};
        }
    }
    return undefined;
}

function hasExplicitQuadRally(request)
{
    return !!(request && (request.rallyFlag || request.rallyPos));
}

function shouldAutoSearchQuadRally(request)
{
    return request && request.autoRally !== false && !hasExplicitQuadRally(request);
}

function serializeQuadRoomPosition(pos)
{
    return pos.roomName + ':' + pos.x + ':' + pos.y;
}

function deserializeQuadRoomPosition(value)
{
    if (typeof value != 'string')
    {
        return undefined;
    }
    var parts = value.split(':');
    if (parts.length != 3 || !isValidRoomName(parts[0]))
    {
        return undefined;
    }
    var x = parseInt(parts[1], 10);
    var y = parseInt(parts[2], 10);
    if (isNaN(x) || isNaN(y) || x < 1 || x > 47 || y < 1 || y > 47)
    {
        return undefined;
    }
    return new RoomPosition(x, y, parts[0]);
}

function clampRoomCoord(value, min, max)
{
    value = Math.round(value);
    if (value < min)
    {
        return min;
    }
    if (value > max)
    {
        return max;
    }
    return value;
}

function getRoomCenterPos(roomName)
{
    if (!isValidRoomName(roomName))
    {
        return undefined;
    }
    return new RoomPosition(25, 25, roomName);
}

function blendRoomPositions(a, b, bWeight)
{
    if (!a)
    {
        return b;
    }
    if (!b)
    {
        return a;
    }
    if (a.roomName != b.roomName)
    {
        return a;
    }
    var aWeight = 1 - bWeight;
    return new RoomPosition(
        clampRoomCoord(a.x * aWeight + b.x * bWeight, 3, 46),
        clampRoomCoord(a.y * aWeight + b.y * bWeight, 3, 46),
        a.roomName);
}

function getAutoQuadRallyMemory(request)
{
    Memory.quads = Memory.quads || {};
    return Memory.quads[request.squad] = Memory.quads[request.squad] || {};
}

function getAutoQuadTargetFlagPos(request)
{
    if (request && request.targetFlag && Game.flags[request.targetFlag])
    {
        return Game.flags[request.targetFlag].pos;
    }
    if (Game.flags.QuadTarget)
    {
        return Game.flags.QuadTarget.pos;
    }
    return undefined;
}

function getAutoQuadRallySignature(request, candidates)
{
    var candidateRooms = [];
    for (var i = 0; candidates && i < candidates.length; i++)
    {
        candidateRooms.push(candidates[i].roomName);
    }
    candidateRooms.sort();
    var targetFlagPos = getAutoQuadTargetFlagPos(request);
    var spawnRooms = request.spawnRooms ? request.spawnRooms.slice().sort().join(',') : '';
    return [
        request.squad || '',
        request.targetRoom || '',
        request.retreatRoom || '',
        request.sourceRoom || '',
        request.manualRallyRoom ? request.rallyRoom : '',
        spawnRooms,
        candidateRooms.join(','),
        targetFlagPos ? serializeQuadRoomPosition(targetFlagPos) : ''
    ].join('|');
}

function addAutoQuadRallyHint(hints, seenRooms, spawnName, roomName, pos)
{
    if (!isValidRoomName(roomName) || !pos || seenRooms[roomName])
    {
        return;
    }
    hints.push({spawnName: spawnName, roomName: roomName, pos: pos});
    seenRooms[roomName] = true;
}

function getAutoQuadRallySpawnHints(request, candidates)
{
    var hints = [];
    var seenRooms = {};
    for (var i = 0; candidates && i < candidates.length; i++)
    {
        var candidate = candidates[i];
        var spawn = Game.spawns[candidate.spawnName];
        if (spawn)
        {
            addAutoQuadRallyHint(hints, seenRooms, spawn.name, spawn.room.name, spawn.pos);
        }
    }
    if (hints.length > 0)
    {
        return hints;
    }

    for (var creepName in Game.creeps)
    {
        var creep = Game.creeps[creepName];
        if (!creep.memory || creep.memory.role != 'quad'
            || getQuadSquadName(creep.memory) != request.squad)
        {
            continue;
        }
        var homeRoom = creep.memory.home || creep.memory.origin || creep.room.name;
        var homeSpawn = getSpawnInRoomName(homeRoom);
        if (homeSpawn)
        {
            addAutoQuadRallyHint(hints, seenRooms, homeSpawn.name, homeSpawn.room.name, homeSpawn.pos);
        }
        else
        {
            addAutoQuadRallyHint(hints, seenRooms, creepName, creep.room.name, creep.pos);
        }
    }
    if (hints.length > 0)
    {
        return hints;
    }

    var spawns = [];
    for (var spawnName in Game.spawns)
    {
        var fallbackSpawn = Game.spawns[spawnName];
        if (fallbackSpawn && isRoomAllowedForQuadRequest(fallbackSpawn.room.name, request))
        {
            spawns.push(fallbackSpawn);
        }
    }
    var referenceRoom = getQuadSpawnReferenceRoom(request);
    spawns.sort(function(a, b)
    {
        var da = isValidRoomName(referenceRoom) ? Game.map.getRoomLinearDistance(a.room.name, referenceRoom) : 0;
        var db = isValidRoomName(referenceRoom) ? Game.map.getRoomLinearDistance(b.room.name, referenceRoom) : 0;
        if (da != db)
        {
            return da - db;
        }
        return a.name < b.name ? -1 : 1;
    });
    for (var s = 0; s < spawns.length && hints.length < request.maxRooms; s++)
    {
        addAutoQuadRallyHint(hints, seenRooms, spawns[s].name, spawns[s].room.name, spawns[s].pos);
    }
    return hints;
}

function getSpawnInRoomName(roomName)
{
    for (var spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        if (spawn && spawn.room && spawn.room.name == roomName)
        {
            return spawn;
        }
    }
    return undefined;
}

function isAutoQuadTargetRoomRallyEligible(request)
{
    if (!isValidRoomName(request.targetRoom))
    {
        return false;
    }
    var room = Game.rooms[request.targetRoom];
    if (!room)
    {
        return false;
    }
    if (room.controller && room.controller.owner && !room.controller.my)
    {
        return false;
    }
    return room.controller == undefined
        || room.controller.my
        || request.targetRoom == request.retreatRoom
        || request.targetRoom == request.sourceRoom;
}

function addAutoQuadRallyRoom(rooms, seenRooms, roomName, priority, reason)
{
    if (!isValidRoomName(roomName) || seenRooms[roomName] || !Game.rooms[roomName])
    {
        return;
    }
    rooms.push({roomName: roomName, priority: priority, reason: reason});
    seenRooms[roomName] = true;
}

function getAutoQuadRallyRooms(request, hints)
{
    var rooms = [];
    var seenRooms = {};
    if (request.manualRallyRoom)
    {
        addAutoQuadRallyRoom(rooms, seenRooms, request.rallyRoom, -400, 'requestedRoom');
    }
    if (isAutoQuadTargetRoomRallyEligible(request))
    {
        addAutoQuadRallyRoom(rooms, seenRooms, request.targetRoom, -300, 'ownedTargetRoom');
    }
    addAutoQuadRallyRoom(rooms, seenRooms, request.retreatRoom, -220, 'retreatRoom');
    addAutoQuadRallyRoom(rooms, seenRooms, request.sourceRoom, -180, 'sourceRoom');
    for (var i = 0; i < hints.length; i++)
    {
        addAutoQuadRallyRoom(rooms, seenRooms, hints[i].roomName, -100 + i, 'spawnHint');
    }
    return rooms;
}

function getAutoQuadHintCenter(roomName, hints)
{
    var x = 0;
    var y = 0;
    var count = 0;
    for (var i = 0; i < hints.length; i++)
    {
        if (hints[i].roomName == roomName && hints[i].pos)
        {
            x += hints[i].pos.x;
            y += hints[i].pos.y;
            count++;
        }
    }
    if (count == 0)
    {
        return undefined;
    }
    return new RoomPosition(
        clampRoomCoord(x / count, 3, 46),
        clampRoomCoord(y / count, 3, 46),
        roomName);
}

function getInwardExitAnchor(exitPos, exit)
{
    if (!exitPos)
    {
        return undefined;
    }
    var x = exitPos.x;
    var y = exitPos.y;
    if (exit == FIND_EXIT_TOP)
    {
        y = 4;
    }
    else if (exit == FIND_EXIT_RIGHT)
    {
        x = 45;
    }
    else if (exit == FIND_EXIT_BOTTOM)
    {
        y = 45;
    }
    else if (exit == FIND_EXIT_LEFT)
    {
        x = 4;
    }
    return new RoomPosition(clampRoomCoord(x, 3, 46), clampRoomCoord(y, 3, 46), exitPos.roomName);
}

function getAutoQuadRallyAnchor(room, request, hints)
{
    var hintCenter = getAutoQuadHintCenter(room.name, hints);
    var targetFlagPos = getAutoQuadTargetFlagPos(request);
    if (targetFlagPos && targetFlagPos.roomName == room.name)
    {
        return blendRoomPositions(hintCenter || getRoomCenterPos(room.name), targetFlagPos, 0.45);
    }
    if (isValidRoomName(request.targetRoom) && request.targetRoom != room.name)
    {
        var exit = room.findExitTo(request.targetRoom);
        if (exit > 0)
        {
            var from = hintCenter || getRoomCenterPos(room.name);
            var exitPos = from.findClosestByRange(exit);
            var exitAnchor = getInwardExitAnchor(exitPos, exit);
            if (exitAnchor)
            {
                return exitAnchor;
            }
        }
    }
    if (isValidRoomName(request.targetRoom) && request.targetRoom == room.name)
    {
        return blendRoomPositions(hintCenter || getRoomCenterPos(room.name), getRoomCenterPos(room.name), 0.45);
    }
    return hintCenter || getRoomCenterPos(room.name);
}

function isAutoQuadRallyBlockingStructure(structure)
{
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

function isAutoQuadRallyBlockingSite(site)
{
    return site.structureType != STRUCTURE_ROAD
        && site.structureType != STRUCTURE_RAMPART
        && site.structureType != STRUCTURE_CONTAINER;
}

function canUseAutoQuadRallyTile(room, terrain, x, y)
{
    if (x < 1 || y < 1 || x > 48 || y > 48)
    {
        return false;
    }
    if (terrain.get(x, y) == TERRAIN_MASK_WALL)
    {
        return false;
    }
    if (room.controller && room.controller.pos.x == x && room.controller.pos.y == y)
    {
        return false;
    }
    if (room.lookForAt(LOOK_SOURCES, x, y).length > 0
        || room.lookForAt(LOOK_MINERALS, x, y).length > 0)
    {
        return false;
    }
    var structures = room.lookForAt(LOOK_STRUCTURES, x, y);
    for (var i = 0; i < structures.length; i++)
    {
        if (isAutoQuadRallyBlockingStructure(structures[i]))
        {
            return false;
        }
    }
    var sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
    for (var s = 0; s < sites.length; s++)
    {
        if (isAutoQuadRallyBlockingSite(sites[s]))
        {
            return false;
        }
    }
    return true;
}

function canUseAutoQuadRallyTopLeft(room, x, y)
{
    if (x < 1 || y < 1 || x > 47 || y > 47)
    {
        return false;
    }
    var terrain = Game.map.getRoomTerrain(room.name);
    return canUseAutoQuadRallyTile(room, terrain, x, y)
        && canUseAutoQuadRallyTile(room, terrain, x + 1, y)
        && canUseAutoQuadRallyTile(room, terrain, x, y + 1)
        && canUseAutoQuadRallyTile(room, terrain, x + 1, y + 1);
}

function getAutoQuadRallyTilePenalty(room, terrain, x, y)
{
    var penalty = 0;
    var terrainType = terrain.get(x, y);
    if (terrainType == TERRAIN_MASK_SWAMP)
    {
        penalty += 2;
    }
    if (x <= 2 || y <= 2 || x >= 47 || y >= 47)
    {
        penalty += 70;
    }
    else if (x <= 4 || y <= 4 || x >= 45 || y >= 45)
    {
        penalty += 18;
    }
    var structures = room.lookForAt(LOOK_STRUCTURES, x, y);
    for (var i = 0; i < structures.length; i++)
    {
        if (structures[i].structureType == STRUCTURE_ROAD)
        {
            penalty += 14;
        }
        else if (structures[i].structureType == STRUCTURE_CONTAINER)
        {
            penalty += 8;
        }
        else if (structures[i].structureType == STRUCTURE_RAMPART)
        {
            penalty += 3;
        }
    }
    return penalty;
}

function getAutoQuadRallyFootprintPenalty(room, x, y)
{
    var terrain = Game.map.getRoomTerrain(room.name);
    return getAutoQuadRallyTilePenalty(room, terrain, x, y)
        + getAutoQuadRallyTilePenalty(room, terrain, x + 1, y)
        + getAutoQuadRallyTilePenalty(room, terrain, x, y + 1)
        + getAutoQuadRallyTilePenalty(room, terrain, x + 1, y + 1);
}

function getAutoQuadRallyTopLeftScore(room, pos, request, hints, roomPriority)
{
    var score = roomPriority;
    var targetFlagPos = getAutoQuadTargetFlagPos(request);
    for (var i = 0; i < hints.length; i++)
    {
        var hint = hints[i];
        if (hint.roomName == room.name && hint.pos)
        {
            score += hint.pos.getRangeTo(pos) * 5;
        }
        else if (isValidRoomName(hint.roomName))
        {
            score += Game.map.getRoomLinearDistance(hint.roomName, room.name) * 70 + 25;
        }
    }
    if (targetFlagPos)
    {
        if (targetFlagPos.roomName == room.name)
        {
            score += pos.getRangeTo(targetFlagPos) * 2;
        }
        else
        {
            score += Game.map.getRoomLinearDistance(room.name, targetFlagPos.roomName) * 90;
        }
    }
    else if (isValidRoomName(request.targetRoom))
    {
        if (request.targetRoom == room.name)
        {
            score += pos.getRangeTo(getRoomCenterPos(room.name));
        }
        else
        {
            score += Game.map.getRoomLinearDistance(room.name, request.targetRoom) * 90;
        }
    }
    if (room.controller && room.controller.my)
    {
        score -= 35;
    }
    if (room.name == request.retreatRoom)
    {
        score -= 15;
    }
    score += getAutoQuadRallyFootprintPenalty(room, pos.x, pos.y);
    return score;
}

function findAutoQuadRallyNear(room, anchor, request, hints, roomPriority, maxRange)
{
    if (!anchor || anchor.roomName != room.name)
    {
        return undefined;
    }
    var best = undefined;
    var bestScore = Infinity;
    for (var range = 0; range <= maxRange; range++)
    {
        for (var dx = -range; dx <= range; dx++)
        {
            for (var dy = -range; dy <= range; dy++)
            {
                if (Math.max(Math.abs(dx), Math.abs(dy)) != range)
                {
                    continue;
                }
                var x = anchor.x + dx;
                var y = anchor.y + dy;
                if (!canUseAutoQuadRallyTopLeft(room, x, y))
                {
                    continue;
                }
                var pos = new RoomPosition(x, y, room.name);
                var score = getAutoQuadRallyTopLeftScore(room, pos, request, hints, roomPriority);
                if (score < bestScore)
                {
                    best = {pos: pos, score: score};
                    bestScore = score;
                }
            }
        }
        if (best && range >= 5)
        {
            return best;
        }
    }
    return best;
}

function findAutoQuadRallyInRoom(roomEntry, request, hints)
{
    var room = Game.rooms[roomEntry.roomName];
    if (!room)
    {
        return undefined;
    }
    var anchor = getAutoQuadRallyAnchor(room, request, hints);
    var result = findAutoQuadRallyNear(room, anchor, request, hints, roomEntry.priority, AUTO_QUAD_RALLY_SEARCH_RANGE);
    if (!result)
    {
        result = findAutoQuadRallyNear(room, getRoomCenterPos(room.name), request, hints, roomEntry.priority + 40, AUTO_QUAD_RALLY_FALLBACK_SEARCH_RANGE);
    }
    if (result)
    {
        result.roomReason = roomEntry.reason;
        result.anchor = anchor ? serializeQuadRoomPosition(anchor) : undefined;
    }
    return result;
}

function findAutoQuadRally(request, candidates)
{
    var hints = getAutoQuadRallySpawnHints(request, candidates);
    var rooms = getAutoQuadRallyRooms(request, hints);
    var best = undefined;
    for (var i = 0; i < rooms.length; i++)
    {
        var result = findAutoQuadRallyInRoom(rooms[i], request, hints);
        if (result && (!best || result.score < best.score))
        {
            best = result;
        }
    }
    return best;
}

function isAutoQuadRallyCachedPositionUsable(pos)
{
    if (!pos)
    {
        return false;
    }
    var room = Game.rooms[pos.roomName];
    return !!(room && canUseAutoQuadRallyTopLeft(room, pos.x, pos.y));
}

function applyAutoQuadRally(request, squadMemory, result, signature)
{
    var serialized = serializeQuadRoomPosition(result.pos);
    request.rallyPos = serialized;
    request.rallyRoom = result.pos.roomName;
    request.autoRallySelected = true;
    squadMemory.rallyPos = serialized;
    squadMemory.rallyRoom = result.pos.roomName;
    squadMemory.autoRally = true;
    squadMemory.autoRallyPos = serialized;
    squadMemory.autoRallyAt = Game.time;
    squadMemory.autoRallySignature = signature;
    squadMemory.autoRallyScore = Math.round(result.score);
    squadMemory.autoRallyReason = result.roomReason;
    squadMemory.autoRallyAnchor = result.anchor;
    delete squadMemory.autoRallyError;
}

function ensureAutoQuadRally(request, candidates)
{
    if (!shouldAutoSearchQuadRally(request))
    {
        return;
    }
    var squadMemory = getAutoQuadRallyMemory(request);
    var signature = getAutoQuadRallySignature(request, candidates || []);
    var cached = deserializeQuadRoomPosition(squadMemory.autoRallyPos);
    if (cached && squadMemory.autoRallySignature == signature
        && squadMemory.autoRallyAt != undefined
        && Game.time - squadMemory.autoRallyAt <= AUTO_QUAD_RALLY_CACHE_TICKS
        && isAutoQuadRallyCachedPositionUsable(cached))
    {
        applyAutoQuadRally(request, squadMemory, {pos: cached, score: squadMemory.autoRallyScore || 0, roomReason: 'cached', anchor: squadMemory.autoRallyAnchor}, signature);
        return;
    }

    var result = findAutoQuadRally(request, candidates || []);
    if (!result && cached && isAutoQuadRallyCachedPositionUsable(cached))
    {
        result = {pos: cached, score: squadMemory.autoRallyScore || 0, roomReason: 'staleCached', anchor: squadMemory.autoRallyAnchor};
    }
    if (result)
    {
        applyAutoQuadRally(request, squadMemory, result, signature);
        return;
    }

    squadMemory.autoRally = true;
    squadMemory.autoRallyAt = Game.time;
    squadMemory.autoRallyError = 'no visible standable 2x2 rally found';
}

function prepareQuadMemory(request)
{
    Memory.quads = Memory.quads || {};
    var squadMemory = Memory.quads[request.squad] = Memory.quads[request.squad] || {};
    squadMemory.targetRoom = request.targetRoom;
    squadMemory.targetFlag = request.targetFlag;
    squadMemory.retreatRoom = request.retreatRoom;
    squadMemory.rallyRoom = request.rallyRoom;
    squadMemory.rallyFlag = request.rallyFlag;
    squadMemory.rallyPos = request.rallyPos;
    squadMemory.boostMode = request.boostMode;
    squadMemory.distributed = request.distributed;
    if (countLiveQuadMembers(request.squad) < 4)
    {
        squadMemory.formed = false;
    }
    return squadMemory;
}

function recordQuadSpawnPlan(request, candidates, missingSlots)
{
    var squadMemory = prepareQuadMemory(request);
    var plan = [];
    for (var i = 0; i < candidates.length; i++)
    {
        plan.push({
            spawn: candidates[i].spawnName,
            room: candidates[i].roomName,
            boost: candidates[i].boostMode,
            boostReady: candidates[i].boostReady,
            nParts: candidates[i].nParts,
            distance: candidates[i].distance
        });
    }
    squadMemory.spawnPlan = plan;
    squadMemory.spawnPlanAt = Game.time;
    squadMemory.spawnMissingSlots = missingSlots;
    if (candidates.length == 0)
    {
        squadMemory.spawnError = request.boostMode == 'required'
            ? 'no nearby spawn has required combat boosts'
            : 'no nearby spawn can spawn a quad member';
    }
    else
    {
        delete squadMemory.spawnError;
    }
}

function getQuadMemberSpawnOptions(request, candidate)
{
    var wantsBoost = candidate.boostMode == 'required';
    return {
        boostMode: candidate.boostMode,
        wantsCombatBoosts: wantsBoost,
        boostStrict: wantsBoost,
        rallyRoom: request.rallyRoom,
        rallyFlag: request.rallyFlag,
        rallyPos: request.rallyPos
    };
}

function handleQuadSpawnPriority(spawn, request)
{
    if (!request || isQuadFormed(request))
    {
        return false;
    }

    // Candidates and the rally can't change within a tick (spawns start next
    // tick), so work them out once per squad rather than once per idle spawn.
    var cache = getMainLoopCache() || {};
    var cacheKey = 'quadSpawn:' + request.squad;
    var cached = cache[cacheKey];
    if (!cached)
    {
        var candidates = getQuadSpawnCandidates(request);
        ensureAutoQuadRally(request, candidates);
        candidates = getQuadSpawnCandidates(request);
        cached = cache[cacheKey] = {
            candidates: candidates,
            rallyPos: request.rallyPos,
            rallyRoom: request.rallyRoom,
            autoRallySelected: request.autoRallySelected
        };
        prepareQuadMemory(request);
    }
    else
    {
        request.rallyPos = cached.rallyPos;
        request.rallyRoom = cached.rallyRoom;
        request.autoRallySelected = cached.autoRallySelected;
        candidates = cached.candidates;
    }
    var missingSlots = getMissingQuadSlots(request.squad);
    if (missingSlots.length == 0)
    {
        // All four bodies exist. Do not block lower-priority support spawning
        // while strict-boosted members wait for lab loading or role.quad packing.
        spawn.memory.spawnQuadWaitingForFormation = true;
        recordQuadSpawnPlan(request, candidates, missingSlots);
        return false;
    }

    recordQuadSpawnPlan(request, candidates, missingSlots);
    var selection = getQuadCandidateForSpawn(candidates, spawn.name);
    if (!selection || selection.index >= missingSlots.length)
    {
        return false;
    }

    delete spawn.memory.spawnQuadWaitingForFormation;
    delete spawn.memory.spawnQuadError;
    var missingSlot = missingSlots[selection.index];
    var options = getQuadMemberSpawnOptions(request, selection.candidate);
    var result = recordSpawnAttempt(spawn,
        spawn.createQuadMember(spawn.room.energyCapacityAvailable,
            request.squad,
            missingSlot,
            request.targetRoom,
            request.targetFlag,
            request.retreatRoom,
            makeCreepName(spawn, 'quad' + request.squad + '-' + missingSlot),
            options),
        'quad');
    spawn.memory.spawnQuadLastResult = result;
    spawn.memory.spawnQuadLastSlot = missingSlot;
    spawn.memory.spawnQuadLastBoostMode = options.boostMode;

    // Selected quad spawns reserve their spawn/energy lane until the member starts.
    // Non-selected rooms keep normal economy spawning so distributed requests do
    // not freeze every owned room.
    return true;
}

function getSoloAttackRequest(spawn)
{
    var sourceMemory = spawn.memory;
    var rawRequest = sourceMemory.spawnSoloAttack;

    if (!rawRequest && spawn.room.memory && spawn.room.memory.spawnSoloAttack)
    {
        sourceMemory = spawn.room.memory;
        rawRequest = sourceMemory.spawnSoloAttack;
    }

    if (!rawRequest)
    {
        return undefined;
    }

    var request = {
        targetRoom: sourceMemory.attackRoom,
        targetFlag: sourceMemory.attackTargetFlag,
        retreatRoom: sourceMemory.attackRetreatRoom || spawn.room.name,
        avoidRooms: sourceMemory.attackAvoidRooms,
        targetId: sourceMemory.attackTargetId,
        style: sourceMemory.attackStyle || 'brawler',
        boosted: sourceMemory.attackBoosted == true,
        sourceMemory: sourceMemory
    };

    if (typeof rawRequest == 'string')
    {
        request.targetRoom = rawRequest;
    }
    else if (typeof rawRequest == 'object')
    {
        request.targetRoom = rawRequest.targetRoom || rawRequest.target || request.targetRoom;
        request.targetFlag = rawRequest.targetFlag || request.targetFlag;
        request.retreatRoom = rawRequest.retreatRoom || request.retreatRoom;
        request.avoidRooms = rawRequest.avoidRooms || request.avoidRooms;
        request.targetId = rawRequest.targetId || request.targetId;
        request.style = rawRequest.style || request.style;
        if (rawRequest.boosted != undefined)
        {
            request.boosted = rawRequest.boosted == true;
        }
        else if (rawRequest.attackBoosted != undefined)
        {
            request.boosted = rawRequest.attackBoosted == true;
        }
    }

    return request;
}

function handleSoloAttackSpawn(spawn, request)
{
    if (!request)
    {
        return false;
    }
    if (spawn.spawning)
    {
        return true;
    }

    var result = recordSpawnAttempt(spawn,
        spawn.createAttacker(spawn.room.energyCapacityAvailable,
            request.targetRoom,
            request.boosted,
            makeCreepName(spawn, 'SoloAttack'),
            request.targetFlag,
            request.retreatRoom,
            request.avoidRooms,
            request.targetId,
            request.style),
        'attacker');

    if (!(result < 0))
    {
        delete request.sourceMemory.spawnSoloAttack;
    }
    else if (result == ERR_NOT_ENOUGH_ENERGY && !canEverSpawnSoloAttacker(spawn.room.energyCapacityAvailable, request.style))
    {
        request.sourceMemory.spawnSoloAttackError = 'not enough energy capacity for ' + (request.style || 'brawler');
        delete request.sourceMemory.spawnSoloAttack;
        return false;
    }
    else if (result != ERR_NOT_ENOUGH_ENERGY)
    {
        request.sourceMemory.spawnSoloAttackError = result;
        delete request.sourceMemory.spawnSoloAttack;
        return false;
    }

    return true;
}

function canEverSpawnSoloAttacker(energyCapacity, style)
{
    if (style == 'raider')
    {
        return energyCapacity >= 560;
    }
    return energyCapacity >= 390;
}

module.exports.loop = function () {
    Memory.creeps = Memory.creeps || {};
    Memory.spawns = Memory.spawns || {};
    for (let spawnName in Memory.spawns)
    {
        if (Game.spawns[spawnName] == undefined)
        {
            delete Memory.spawns[spawnName];
        }
    }
    for(let creepName in Memory.creeps)
    {
        if (Game.creeps[creepName] == undefined)
        {
            delete Memory.creeps[creepName];
        }
    }
    // Squad memory outlives its creeps. Drop it once nothing has run the squad
    // (lastRun) or planned its spawn (spawnPlanAt) for 1500 ticks.
    if (Memory.quads && Game.time % 100 == 0)
    {
        for (let squad in Memory.quads)
        {
            let squadMemory = Memory.quads[squad] || {};
            if (countLiveQuadMembers(squad) == 0
                && Game.time - Math.max(squadMemory.lastRun || 0, squadMemory.spawnPlanAt || 0) > 1500)
            {
                delete Memory.quads[squad];
            }
        }
    }
    for (let spawnName in Game.spawns)
    {
        ensureSpawnMemoryDefaults(Game.spawns[spawnName]);
    }
    powerCreepManager.run();
    trafficStats.beginTick();
    flowTraffic.beginTick();
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        trafficStats.observeCreepBefore(creep);
        if (keepLocalCreepInHomeRoom(creep))
        {
            observeCreepMovementAfter(creep);
            continue;
        }
        if (handleMoveAsideForMiner(creep))
        {
            observeCreepMovementAfter(creep);
            continue;
        }
        if (handleMoveAsideForSpawnDrop(creep))
        {
            observeCreepMovementAfter(creep);
            continue;
        }
        if (handleMoveAsideForTraffic(creep))
        {
            observeCreepMovementAfter(creep);
            continue;
        }
        requestTrafficYieldForStuckCreep(creep);
        if (handleCombatBoosting(creep))
        {
            observeCreepMovementAfter(creep);
            continue;
        }
        if (creep.memory.role == 'harvester')
        {
            roleHarvester.run(creep);
        }
        else if (creep.memory.role == 'upgrader')
        {
            roleUpgrader.run(creep);
        }
        else if (creep.memory.role == 'builder')
        {
            roleBuilder.run(creep);
        }
        else if (creep.memory.role == 'repairer')
        {
            roleRepairer.run(creep);
        }
        else if (creep.memory.role == 'longDistanceHarvester')
        {
            rolelongDistanceHarvester.run(creep);
        }
        else if (creep.memory.role == 'claimer')
        {
            roleClaimer.run(creep);
        }
        else if (creep.memory.role == 'reserver')
        {
            roleReserver.run(creep);
        }
        else if (creep.memory.role == 'controllerAttacker')
        {
            roleControllerAttacker.run(creep);
        }
        else if (creep.memory.role == 'miner')
        {
            roleMiner.run(creep);
        }
        else if (creep.memory.role == 'lorry')
        {
            roleLorry.run(creep);
        }
        else if (creep.memory.role == 'remoteLorry')
        {
            roleRemoteLorry.run(creep);
        }
        else if (creep.memory.role == 'remoteCarrier')
        {
            roleRemoteCarrier.run(creep);
        }
        else if (creep.memory.role == 'remoteBuilder')
        {
            roleRemoteBuilder.run(creep);
        }
        else if (creep.memory.role == 'attacker')
        {
            roleAttacker.run(creep);
        }
        else if (creep.memory.role == 'quad')
        {
            roleQuad.run(creep);
        }
        else if (creep.memory.role == 'defender')
        {
            roleDefender.run(creep);
        }
        else if (creep.memory.role == 'healer')
        {
            roleHealer.run(creep);
        }
        else if (creep.memory.role == 'remoteHealer')
        {
            roleRemoteHealer.run(creep);
        }
        else if (creep.memory.role == 'Slinker'
            || creep.memory.role == 'Clinker'
            || creep.memory.role == 'Blinker')
        {
            roleLinker.run(creep);
        }
        else if (creep.memory.role == 'extractor')
        {
            roleExtractor.run(creep);
        }
        else if (creep.memory.role == 'mineralLorry')
        {
            rolemineralLorry.run(creep);
        }
        observeCreepMovementAfter(creep);
    }
    trafficStats.endTick();
    flowTraffic.endTick();
    var spawnNames = getAllSpawnNamesSorted();
    for (let spawnName of spawnNames)
    {
        let spawn = Game.spawns[spawnName];
        syncSameRoomSpawnMemory(spawn);
        cleanupObsoleteSpawnMemory(spawn);
        // A busy secondary spawn can't use this tick's plan; the primary already
        // handles the room-level work (towers, safe mode, market, labs).
        if (spawn.spawning && !isPrimaryRoomSpawn(spawn))
        {
            continue;
        }
        let creepsInRoom = getRoomMyCreeps(spawn.room);
        if (isControllerDowngradeEmergency(spawn.room)
            && !spawn.spawning
            && countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'upgrader') < 1)
        {
            name = recordSpawnAttempt(spawn,
                spawn.createCustomCreep(spawn.room.energyAvailable,
                    'upgrader',
                    makeCreepName(spawn, 'upgrader')),
                'upgrader');
            if (!(name < 0))
            {
                continue;
            }
        }
        var roomPlan = getCachedRoomPlan(spawn.room);
        var hostileInfo = getRoomHostileInfo(spawn.room);
        var hostiles = hostileInfo.hostiles;
        var playerHostiles = hostileInfo.playerHostiles;
        spawn.room.memory.hostileCount = hostiles.length;
        spawn.room.memory.hostilePlayerCount = playerHostiles.length;
        spawn.room.memory.hostileNpcCount = hostiles.length - playerHostiles.length;
        if (hostiles.length > 0)
        {
            spawn.room.memory.hostileLastSeen = Game.time;
            spawn.room.memory.hostileLastOwner = getOwnerName(hostiles[0]);
        }
        if (playerHostiles.length > 0)
        {
            spawn.room.memory.hostilePlayerLastSeen = Game.time;
        }
        if (hostiles.length > playerHostiles.length)
        {
            spawn.room.memory.hostileNpcLastSeen = Game.time;
        }
        if (isPrimaryRoomSpawn(spawn))
        {
            triggerAutoSafeMode(spawn.room, spawn, hostiles);
            powerSpawnManager.run(spawn);
        }
        if (isPrimaryRoomSpawn(spawn))
        {
            // Sells the room's own mineral above a reserve; throttles itself.
            mineralSellMarket.maintain(spawn.room);
        }
        if (spawn.room.terminal && shouldRunMarketCheck(spawn))
        {
            // Fully filled orders only take up room toward the 300-order cap.
            for (let id in Game.market.orders)
            {
                if (Game.market.orders[id].remainingAmount <= 0)
                {
                    Game.market.cancelOrder(id);
                }
            }
            combatBoostMarket.maintain(spawn);
            specialStructureMarket.maintain(spawn);
            energyReserveMarket.maintain(spawn);
        }
        var nH = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'harvester');
        var nB = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'builder');
        var nU = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'upgrader');
        var nR = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'repairer');
        var nM = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'miner');
        var nL = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'lorry');
        var nAttackers = countGlobalRoleWithPlanned('attacker');
        var nDefenders = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'defender');
        var nHealers = countGlobalRoleWithPlanned('healer');
        var nRoomHealers = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'healer');
        var quadRequest = getQuadSpawnRequest(spawn);
        var soloAttackRequest = getSoloAttackRequest(spawn);
        var nSLinkers = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'Slinker');
        var nCLinkers = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'Clinker');
        var nBLinkers = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'Blinker');
        var nE = countRoomRoleWithPlanned(spawn.room, creepsInRoom, 'extractor');
        var energy = getSharedRoomSpawnEnergy(spawn);
        var localLorryEnergy = Math.min(getLocalLorrySpawnEnergy(spawn), energy);
        spawn.memory.localLorrySpawnEnergy = localLorryEnergy;
        var minerBodyCost = 650;
        var canSpawnMiner = energy >= minerBodyCost;
        var name = undefined;
        var sources = roomPlan.sources;
        var sourceContainerCount = roomPlan.sourceContainerCount;
        var containerSetupReady = sources.length > 0 && sourceContainerCount >= sources.length;
        applyRclCreepCountTargets(spawn,
            sources.length,
            containerSetupReady,
            canSpawnMiner,
            roomPlan.controllerLinkReady,
            roomPlan.baseLinkReady,
            roomPlan.extractorReady,
            roomPlan.mineralReady,
            roomPlan.constructionSiteCount);
        if (!roomPlan.controllerLinkReady)
        {
            spawn.memory.minCLinkers = 0;
        }
        spawn.memory.controllerLinkReady = roomPlan.controllerLinkReady;
        spawn.memory.baseLinkReady = roomPlan.baseLinkReady;
        spawn.memory.extractorReady = roomPlan.extractorReady;
        spawn.memory.mineralReady = roomPlan.mineralReady;
        spawn.memory.mineralAmount = roomPlan.mineralAmount;
        spawn.memory.mineralRegeneration = roomPlan.mineralRegeneration;
        spawn.memory.mineralType = roomPlan.mineralType;
        spawn.memory.mineralContainerId = roomPlan.mineralContainerId;
        spawn.memory.mineralContainerMineralAmount = roomPlan.mineralContainerMineralAmount;
        spawn.memory.mineralContainerNeedsLorry = roomPlan.mineralContainerNeedsLorry;
        var remoteSpawnPlan = remoteMining.getSpawnPlan(spawn);
        var remoteBuildPlan = remoteBuild.getSpawnPlan(spawn);
        var specialStructureLoadRequest = specialStructureMarket.getLoadRequest(spawn, creepsInRoom);
        var combatBoostLabLoadRequest = getCombatBoostLabLoadRequest(spawn, creepsInRoom);
        var defaultRemote = remoteSpawnPlan.defaultRemote;
        var nlE11S23Source0 = defaultRemote.harvesterCount
            + getPlannedRemoteSpawnCount(spawn.room,
                'longDistanceHarvester',
                defaultRemote.roomName,
                defaultRemote.sourceId);
        var nRemoteLorriesE9S17 = defaultRemote.remoteLorryCount
            + getPlannedRemoteSpawnCount(spawn.room,
                'remoteLorry',
                defaultRemote.roomName,
                defaultRemote.sourceId);
        var remoteE9S17Reserved = defaultRemote.reserved;
        var remoteE9S17WorkParts = defaultRemote.harvesterWorkParts;
        var manualReserveRequest = remoteSpawnPlan.manualReserveRequest;
        var bootstrapHarvesterTarget = Math.max(spawn.memory.minHarvesters || 0, sources.length || 1);
        var useHarvesterBootstrap = !containerSetupReady || !canSpawnMiner;
        var whiteFlagPlan = getCachedWhiteFlagPlan(spawn.room, sources, roomPlan.sourceLinkSourceIds);
        var whiteFlags = whiteFlagPlan.count;
        var slinkerSourceId = findUnassignedSlinkerSourceId(spawn.room,
            sources,
            whiteFlagPlan.sourceIds,
            creepsInRoom);
        var towers = roomPlan.towers;
        //
        //
        //
        var boostLabs = getCachedBoostLabs(spawn.room);
        var uLab1 = boostLabs.upgrader;
        var hLab1 = boostLabs.healer;
        var uBody = undefined;
        var hBody = undefined;
        // Only pull upgraders to the lab when it can actually boost them, and only
        // once per room: a lab with leftover XGH2O kept dragging them off the controller.
        if (isPrimaryRoomSpawn(spawn) && spawn.room.terminal && nU > 0 && uLab1
            && uLab1.store.getUsedCapacity(RESOURCE_CATALYZED_GHODIUM_ACID) >= LAB_BOOST_MINERAL
            && uLab1.store.getUsedCapacity(RESOURCE_ENERGY) >= LAB_BOOST_ENERGY)
        {
            uBody = [];
            for (let creep of creepsInRoom)
            {
                if (creep.memory.role == 'upgrader')
                {
                    uBody.push(creep);
                }
            }
        }
        if (spawn.room.terminal && nHealers > 0 && hLab1)
        {
            hBody = [];
            for (let creep of creepsInRoom)
            {
                if (creep.memory.role == 'healer'
                    && creep.memory.boostProfile == undefined)
                {
                    hBody.push(creep);
                }
            }
        }
        // Combat T3 boosting is handled before combat role dispatch so boosted
        // attackers/quads/defenders do not leave home after only one boost type.
        if (uLab1 && uBody)
        {
            for (let creep of uBody)
            {
                //uLab1.boostCreep(creep.body.boost);
                if (creep.memory.boosted != true)
                {
                    var boostResult = uLab1.boostCreep(creep);
                    if (boostResult == ERR_NOT_IN_RANGE)
                    {
                        creep.moveTo(uLab1);
                    }
                    else if (boostResult == OK || boostResult == ERR_NOT_FOUND)
                    {
                        creep.memory.boosted = true;
                    }
                }
            }
        }
        if (hLab1 && hBody)
        {
            for (let creep of hBody)
            {
                //uLab1.boostCreep(creep.body.boost);
                if (creep.memory.boosted != true)
                {
                    var boostResult = hLab1.boostCreep(creep);
                    if (boostResult == ERR_NOT_IN_RANGE)
                    {
                        creep.moveTo(hLab1);
                    }
                    else if (boostResult == OK)
                    {
                        creep.memory.boosted = true;
                    }
                }
            }
        }
        //
        //
        //
        //
        //
        //
        var rampartTargetHits = getSpawnRampartTargetHits(spawn);
        var ownedRamparts = getRoomOwnedRamparts(spawn.room);
        var rampartsBelowTarget = [];
        var decayingRamparts = [];
        for (let rampart of ownedRamparts)
        {
            if (rampart.hits < rampartTargetHits)
            {
                rampartsBelowTarget.push(rampart);
            }
            if (rampart.hits < TOWER_RAMPART_DECAY_BUFFER_HITS)
            {
                decayingRamparts.push(rampart);
            }
        }
        var towerRampartMaintenanceAvailable = !!(spawn.room.controller
            && spawn.room.controller.my
            && spawn.room.controller.level >= TOWER_MAINTENANCE_MIN_RCL
            && towers.length > 0);
        var rampartRepairPolicy = updateRampartRepairStatus(spawn,
            ownedRamparts,
            rampartsBelowTarget,
            towerRampartMaintenanceAvailable);
        if (isPrimaryRoomSpawn(spawn))
        {
            runTowerDefense(spawn.room,
                towers,
                hostiles,
                decayingRamparts,
                creepsInRoom,
                rampartRepairPolicy.towerMaintenanceRamparts);
        }
        if (spawn.spawning)
        {
            continue;
        }
        // Scouts and passing haulers are tower food; only armed, healing, WORK or
        // CLAIM player creeps are worth a defender and its healer.
        var dangerousPlayerHostiles = playerHostiles.filter(isDangerousTowerHostile);
        if (dangerousPlayerHostiles.length >= 1 && nDefenders == 0)
        {
            name = recordSpawnAttempt(spawn,
                spawn.createDefender(spawn.room.energyAvailable, spawn.room.name, makeCreepName(spawn, 'defender')),
                'defender');
            if (!(name < 0))
            {
                continue;
            }
        }
        if (dangerousPlayerHostiles.length >= 1 && nDefenders > nRoomHealers)
        {
            name = recordSpawnAttempt(spawn,
                spawn.createHealer(spawn.room.energyAvailable, spawn.room.name, makeCreepName(spawn, 'healer')),
                'healer');
            if (!(name < 0))
            {
                continue;
            }
        }
        if (handleQuadSpawnPriority(spawn, quadRequest))
        {
            continue;
        }
        if (handleSoloAttackSpawn(spawn, soloAttackRequest))
        {
            continue;
        }
            if (useHarvesterBootstrap && nH < bootstrapHarvesterTarget)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(spawn.room.energyAvailable, 'harvester', makeCreepName(spawn, 'harvester')),
                    'harvester');
            }
            else if (nH == 0 && (nM > 0 || nSLinkers > 0) && nL == 0)
            {
                // Absolute hauler recovery: if miners or SLinkers exist but hauling is gone,
                // spawn an affordable lorry before waiting for the normal target body.
                name = recordSpawnAttempt(spawn,
                    spawn.createLorry(spawn.room.energyAvailable, 'lorry', makeCreepName(spawn, 'lorry')),
                    'lorry');
            }
            else if (nH == 0 && nM == 0 && nSLinkers == 0
                && (!containerSetupReady || !canSpawnMiner || spawn.room.energyAvailable < minerBodyCost))
            {
                // Bootstrap/collapse recovery only. In mature rooms that can spawn
                // the fixed miner body now, let the miner/SLinker replacement blocks
                // below run instead of preempting them with a harvester.
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(spawn.room.energyAvailable, 'harvester', makeCreepName(spawn, 'harvester')),
                    'harvester');
            }
            if ((name == undefined || name < 0) && containerSetupReady && canSpawnMiner)
            {
                for (let source of sources)
                {
                    let sourceHasLinkFlag = !!whiteFlagPlan.sourceIds[source.id];
                    let sourceHasSlinker = hasSlinkerForSource(creepsInRoom, source.id)
                        || hasSpawningCreepForSource(spawn.room, creepsInRoom, 'Slinker', source.id)
                        || hasPlannedSlinkerForSource(spawn.room, source.id);
                    if (!sourceHasLinkFlag
                        && !sourceHasSlinker
                        && !hasPlannedMinerForSource(spawn.room, source.id)
                        && !hasSpawningCreepForSource(spawn.room, creepsInRoom, 'miner', source.id)
                        && !_.some(creepsInRoom, (c) => c.memory.role == 'miner'
                            && c.memory.sourceId == source.id))
                    {
                        if (roomPlan.sourceContainerSourceIds[source.id])
                        {
                            name = recordSpawnAttempt(spawn,
                                spawn.createMiner(source.id, makeCreepName(spawn, 'miner')),
                                'miner',
                                {sourceId: source.id});
                            break;
                        }
                    }
                }
            }
        if (name == undefined || name < 0)
        {
            if (nH < spawn.memory.minHarvesters)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(energy, 'harvester', makeCreepName(spawn, 'harvester')),
                    'harvester');
            }
            else if (spawn.memory.claimRoom != undefined)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createClaimer(spawn.memory.claimRoom, makeCreepName(spawn, 'Claimer'), spawn.memory.claimAvoidRooms),
                    'claimer');
                if (!(name < 0))
                {
                    firstSpawnRuntime.recordClaim(spawn.memory.claimRoom, spawn.room.name);
                    delete spawn.memory.claimRoom;
                    delete spawn.memory.claimAvoidRooms;
                }
            }
            else if (spawn.memory.attackControllerRoom != undefined || spawn.memory.controllerAttackRoom != undefined)
            {
                var controllerTargetRoom = spawn.memory.attackControllerRoom || spawn.memory.controllerAttackRoom;
                var controllerAvoidRooms = spawn.memory.attackControllerAvoidRooms || spawn.memory.controllerAttackAvoidRooms;
                name = recordSpawnAttempt(spawn,
                    spawn.createControllerAttacker(energy,
                        controllerTargetRoom,
                        makeCreepName(spawn, 'ControllerAttacker'),
                        controllerAvoidRooms),
                    'controllerAttacker');
                if (!(name < 0))
                {
                    delete spawn.memory.attackControllerRoom;
                    delete spawn.memory.controllerAttackRoom;
                    delete spawn.memory.attackControllerAvoidRooms;
                    delete spawn.memory.controllerAttackAvoidRooms;
                    delete spawn.memory.attackControllerError;
                }
                else if (name == ERR_NOT_ENOUGH_ENERGY && spawn.room.energyCapacityAvailable < 700)
                {
                    spawn.memory.attackControllerError = 'not enough energy capacity for controller attacker';
                    delete spawn.memory.attackControllerRoom;
                    delete spawn.memory.controllerAttackRoom;
                    delete spawn.memory.attackControllerAvoidRooms;
                    delete spawn.memory.controllerAttackAvoidRooms;
                }
                else if (name != ERR_NOT_ENOUGH_ENERGY)
                {
                    spawn.memory.attackControllerError = name;
                    delete spawn.memory.attackControllerRoom;
                    delete spawn.memory.controllerAttackRoom;
                    delete spawn.memory.attackControllerAvoidRooms;
                    delete spawn.memory.controllerAttackAvoidRooms;
                }
            }
            else if (nAttackers < spawn.memory.minAttackers)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createAttacker(energy,
                        spawn.memory.attackRoom,
                        spawn.memory.attackBoosted || false,
                        makeCreepName(spawn, 'Attacker'),
                        spawn.memory.attackTargetFlag,
                        spawn.memory.attackRetreatRoom || spawn.room.name,
                        spawn.memory.attackAvoidRooms,
                        spawn.memory.attackTargetId,
                        spawn.memory.attackStyle),
                    'attacker');
            }
            else if (nHealers < spawn.memory.minHealers)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createHealer(energy, spawn.memory.attackRoom, makeCreepName(spawn, 'Healer'),
                        spawn.memory.attackAvoidRooms),
                    'healer');
            }
            else if (nSLinkers < whiteFlags && slinkerSourceId != undefined)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createSLinker(slinkerSourceId, makeCreepName(spawn, 'Slinker')),
                    'Slinker',
                    {sourceId: slinkerSourceId});
            }
            else if (containerSetupReady && nL < spawn.memory.minLorries)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createLorry(localLorryEnergy, 'lorry', makeCreepName(spawn, 'lorry')),
                    'lorry');
            }
            else if (rampartRepairPolicy.repairerRamparts.length > 0
                && nR < Math.max(1, spawn.memory.minRepairers || 0))
            {
                // Build new/seriously depleted ramparts with a creep. Once every
                // current rampart has reached target, towers absorb normal decay
                // until the weakest rampart falls below the 95% restart threshold.
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(energy, 'repairer', makeCreepName(spawn, 'repairer')),
                    'repairer');
            }
            else if (specialStructureLoadRequest
                && !hasPlannedRoomRoleSpawn(spawn.room, 'mineralLorry')
                && !hasSpawningMineralLorryForSpecialStructure(spawn.room,
                    creepsInRoom,
                    specialStructureLoadRequest.structureId)
                && !hasMineralLorryForSpecialStructure(creepsInRoom,
                    specialStructureLoadRequest.structureId,
                    specialStructureLoadRequest.resource))
            {
                var specialStructureLorryName = specialStructureLoadRequest.resource == RESOURCE_POWER
                    ? 'powerLorry'
                    : 'mineralLorry';
                name = recordSpawnAttempt(spawn,
                    spawn.createMinerallorry(Math.min(1200, energy),
                        'mineralLorry',
                        specialStructureLoadRequest.resource,
                        makeCreepName(spawn, specialStructureLorryName),
                        undefined,
                        undefined,
                        specialStructureLoadRequest.structureId,
                        specialStructureLoadRequest.structureType),
                    'mineralLorry');
            }
            else if (combatBoostLabLoadRequest
                && !hasPlannedRoomRoleSpawn(spawn.room, 'mineralLorry'))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createMinerallorry(600,
                        'mineralLorry',
                        combatBoostLabLoadRequest.resource,
                        makeCreepName(spawn, 'mineralLorry'),
                        combatBoostLabLoadRequest.labId),
                    'mineralLorry');
            }
            else if (roomPlan.mineralContainerNeedsLorry
                && roomPlan.mineralContainerId != undefined
                && roomPlan.mineralType != undefined
                && !hasPlannedMineralLorryForContainer(spawn.room, roomPlan.mineralContainerId)
                && !hasSpawningMineralLorryForContainer(spawn.room,
                    creepsInRoom,
                    roomPlan.mineralContainerId)
                && !hasMineralLorryForContainer(creepsInRoom,
                    roomPlan.mineralContainerId,
                    roomPlan.mineralType))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createMinerallorry(600,
                        'mineralLorry',
                        roomPlan.mineralType,
                        makeCreepName(spawn, 'mineralLorry'),
                        undefined,
                        roomPlan.mineralContainerId),
                    'mineralLorry',
                    {containerId: roomPlan.mineralContainerId});
            }
            else if (remoteBuildPlan.claimerRequest
                && !hasPlannedRoomRoleSpawn(spawn.room, 'claimer'))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createClaimer(remoteBuildPlan.claimerRequest.target,
                        makeCreepName(spawn, 'RemoteBuildClaimer'),
                        remoteBuildPlan.claimerRequest.avoidRooms),
                    'claimer');
            }
            else if (remoteBuildPlan.carrierRequest
                && !hasPlannedRoomRoleSpawn(spawn.room, 'remoteCarrier'))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createRemoteCarrier(energy,
                        remoteBuildPlan.carrierRequest.home,
                        remoteBuildPlan.carrierRequest.target,
                        remoteBuildPlan.carrierRequest.mission,
                        remoteBuildPlan.carrierRequest.depotPos,
                        remoteBuildPlan.carrierRequest.avoidRooms,
                        makeCreepName(spawn, 'remoteCarrier'),
                        remoteBuildPlan.carrierRequest.bodyProfile),
                    'remoteCarrier');
            }
            else if (remoteBuildPlan.builderRequest
                && !hasPlannedRoomRoleSpawn(spawn.room, 'remoteBuilder'))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createRemoteBuilder(energy,
                        remoteBuildPlan.builderRequest.home,
                        remoteBuildPlan.builderRequest.target,
                        remoteBuildPlan.builderRequest.mission,
                        remoteBuildPlan.builderRequest.depotPos,
                        remoteBuildPlan.builderRequest.avoidRooms,
                        makeCreepName(spawn, 'remoteBuilder'),
                        remoteBuildPlan.builderRequest.bodyProfile),
                    'remoteBuilder');
            }
            else if (defaultRemote.active
                && nlE11S23Source0 < spawn.memory.minLDH_E11S23Source0)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createLongDistanceHarvester(energy,
                        remoteE9S17WorkParts,
                        spawn.room.name,
                        defaultRemote.roomName,
                        defaultRemote.sourceId,
                        makeCreepName(spawn, 'LDH'),
                        remoteE9S17Reserved),
                    'longDistanceHarvester',
                    {remoteRoom: defaultRemote.roomName, sourceId: defaultRemote.sourceId});
            }
            else if (defaultRemote.active
                && nRemoteLorriesE9S17 < spawn.memory.minRemoteLorriesE9S17)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createRemoteLorry(energy, spawn.room.name, defaultRemote.roomName, defaultRemote.sourceId, makeCreepName(spawn, 'remoteLorry')),
                    'remoteLorry',
                    {remoteRoom: defaultRemote.roomName, sourceId: defaultRemote.sourceId});
            }
            else if (manualReserveRequest
                && (manualReserveRequest.roomName != defaultRemote.roomName || defaultRemote.isOwner)
                && spawn.room.energyCapacityAvailable >= 650
                && !hasPlannedRoomRoleSpawn(spawn.room, 'reserver'))
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createReserver(spawn.room.energyAvailable,
                        manualReserveRequest.roomName,
                        makeCreepName(spawn, 'reserver'),
                        manualReserveRequest.avoidRooms),
                    'reserver');
            }
            else if (roomPlan.controllerLinkReady && nCLinkers < spawn.memory.minCLinkers)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(energy, 'Clinker', makeCreepName(spawn, 'Clinker')),
                    'Clinker');
            }
            else if ((roomPlan.baseLinkReady || roomPlan.controllerLinkReady)
                && nBLinkers < spawn.memory.minBLinkers)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createLorry(600, 'Blinker', makeCreepName(spawn, 'Blinker')),
                    'Blinker');
            }
            else if (nB < spawn.memory.minBuilders)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(energy, 'builder', makeCreepName(spawn, 'builder')),
                    'builder');
            }
            else if (nU < spawn.memory.minUpgraders)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createCustomCreep(getUpgraderSpawnEnergy(spawn, energy), 'upgrader', makeCreepName(spawn, 'upgrader')),
                    'upgrader');
            }
            else if (roomPlan.extractorReady && roomPlan.mineralReady && nE < spawn.memory.minExtractors)
            {
                name = recordSpawnAttempt(spawn,
                    spawn.createLinker(energy, 'extractor', false, makeCreepName(spawn, 'extractor')),
                    'extractor');
            }
            else if (spawn.memory.spawnMineralLorry != undefined)
            {
                var requestedMineralType = spawn.memory.spawnMineralLorry == true
                    ? RESOURCE_CATALYZED_LEMERGIUM_ACID
                    : spawn.memory.spawnMineralLorry;
                name = recordSpawnAttempt(spawn,
                    spawn.createMinerallorry(600, 'mineralLorry', requestedMineralType, makeCreepName(spawn, 'mineralLorry')),
                    'mineralLorry');
                if (!(name < 0))
                {
                    delete spawn.memory.spawnMineralLorry;
                }
            }
        }
    }
    // Towers and auto safe mode normally run with each room's primary spawn. Catch
    // owned rooms that skipped that: no living spawn (e.g. under siege), or a
    // primary spawn that took the emergency-upgrader `continue`.
    for (let roomName in Game.rooms)
    {
        let room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my
            || (global.towerDefenseRunTick == Game.time && global.towerDefenseRunRooms[roomName]))
        {
            continue;
        }
        let roomHostiles = getRoomHostileInfo(room).hostiles;
        triggerAutoSafeMode(room, getRoomPrimarySpawn(room), roomHostiles);
        let roomDecaying = getRoomOwnedRamparts(room).filter((r) => r.hits < TOWER_RAMPART_DECAY_BUFFER_HITS);
        runTowerDefense(room, getCachedRoomPlan(room).towers, roomHostiles, roomDecaying, getRoomMyCreeps(room), []);
    }
    // Read-only unless explicitly configured; run once per room after defense
    // telemetry and spawn decisions, not once for each same-room spawn.
    baseBuilderRuntime.run();
    firstSpawnRuntime.run();
}