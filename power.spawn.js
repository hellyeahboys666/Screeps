// Processes stocked Power Spawn resources while keeping refill policy separate.
// Existing energy already inside a Power Spawn is committed to power processing;
// local lorries only replenish it once the room energy reserve is healthy.

var energyReserve = require('energy.reserve');
var specialStructureMarket = require('market.specialStructures');
var DEFAULT_POWER_SPAWN_ENERGY_COST = 50;

function getPowerSpawnEnergyCost()
{
    return typeof POWER_SPAWN_ENERGY_RATIO == 'number'
        ? POWER_SPAWN_ENERGY_RATIO
        : DEFAULT_POWER_SPAWN_ENERGY_COST;
}

function isEnabled(spawn)
{
    if (!spawn || !spawn.room)
    {
        return false;
    }
    return spawn.memory.powerSpawnProcessingEnabled !== false
        && spawn.room.memory.powerSpawnProcessingEnabled !== false
        && Memory.powerSpawnProcessingEnabled !== false;
}

function getOwnedPowerSpawns(room)
{
    return specialStructureMarket.getOwnedStructures(room, STRUCTURE_POWER_SPAWN);
}

function getStored(structure, resource)
{
    if (!structure || !structure.store)
    {
        return 0;
    }
    return structure.store.getUsedCapacity(resource) || 0;
}

function run(spawn)
{
    if (!spawn || !spawn.room)
    {
        return undefined;
    }

    var room = spawn.room;
    var reserve = energyReserve.getReserveStatus(room);
    var status = {
        tick: Game.time,
        enabled: isEnabled(spawn),
        room: room.name,
        energyReserve: reserve,
        refillAllowed: !energyReserve.needsRoomEnergyReserve(room),
        powerSpawns: []
    };
    room.memory.powerSpawnProcessingStatus = status;

    if (!status.enabled)
    {
        status.reason = 'disabled';
        return status;
    }

    var energyCost = getPowerSpawnEnergyCost();
    var powerSpawns = getOwnedPowerSpawns(room);
    if (powerSpawns.length == 0)
    {
        status.reason = 'no Power Spawn';
        return status;
    }

    status.energyCost = energyCost;
    for (let powerSpawn of powerSpawns)
    {
        let power = getStored(powerSpawn, RESOURCE_POWER);
        let energy = getStored(powerSpawn, RESOURCE_ENERGY);
        let powerSpawnStatus = {
            id: powerSpawn.id,
            power: power,
            energy: energy
        };
        status.powerSpawns.push(powerSpawnStatus);

        if (power < 1)
        {
            powerSpawnStatus.reason = 'no power';
            continue;
        }
        if (energy < energyCost)
        {
            powerSpawnStatus.reason = 'not enough energy';
            continue;
        }

        powerSpawnStatus.result = powerSpawn.processPower();
    }
    return status;
}

module.exports = {
    getPowerSpawnEnergyCost: getPowerSpawnEnergyCost,
    getOwnedPowerSpawns: getOwnedPowerSpawns,
    isEnabled: isEnabled,
    run: run
};
