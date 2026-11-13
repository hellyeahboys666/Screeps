module.exports = function() {
        StructureSpawn.prototype.createCustomCreep =
        function(energy, roleName, numbers)
        {
            var nParts = Math.floor(energy/200);
            if (nParts > 16)
            {
                nParts = 16;
            }
            if (nParts < 1)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }
            var body = [];
            for (let i = 0; i < nParts; i++)
            {
                body.push(WORK);
            }
            for (let i = 0; i < nParts; i++)
            {
                body.push(CARRY);
            }
            for (let i = 0; i < nParts; i++)
            {
                body.push(MOVE);
            }
            return this.spawnCreep(body, numbers, {
            memory: {role: roleName, empty: true, boosted: false, home: this.room.name}
            });
        };
        StructureSpawn.prototype.createLongDistanceHarvester = 
        function(energy, nWParts, home, target, sourceId, numbers, reserved)
        {
            var budget = energy;
            var reservedRemote = reserved == true;
            var minWorkParts = reservedRemote ? 5 : 3;
            var desiredWorkParts = Math.max(minWorkParts, nWParts || (reservedRemote ? 6 : 3));
            var workParts = Math.min(desiredWorkParts, 49);

            function targetMovePartsFor(workPartCount)
            {
                if (workPartCount >= 5)
                {
                    return Math.min(3, Math.max(1, 50 - workPartCount));
                }
                return 1;
            }

            var moveParts = targetMovePartsFor(workParts);

            // Dedicated remote drop miner: no CARRY parts. Screeps harvest()
            // drops energy on the ground when there is no empty CARRY capacity;
            // remote lorries pick it up or withdraw from a source container.
            // Unreserved source: 1500/300 = 5 e/tick, so 3 WORK harvests 6 e/tick.
            // Reserved source: 3000/300 = 10 e/tick; prefer faster 5-6 WORK bodies
            // with 2-3 MOVE so the miner does not spend hundreds of ticks in transit.
            // Degrade from 6W3M -> 6W2M -> 5W3M -> 5W2M -> 5W1M as budget requires.
            while ((workParts * 100 + moveParts * 50 > budget || workParts + moveParts > 50)
                && (workParts > minWorkParts || moveParts > 1))
            {
                if (workParts >= 5 && moveParts > 2)
                {
                    moveParts--;
                }
                else if (workParts > minWorkParts)
                {
                    workParts--;
                    moveParts = targetMovePartsFor(workParts);
                }
                else if (moveParts > 1)
                {
                    moveParts--;
                }
            }
            if (workParts < minWorkParts
                || workParts + moveParts > 50
                || workParts * 100 + moveParts * 50 > budget)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }

            var body = [];
            for (let i = 0; i < workParts; i++)
            {
                body.push(WORK);
            }
            for (let i = 0; i < moveParts; i++)
            {
                body.push(MOVE);
            }
            return this.spawnCreep(body, numbers,
            {memory:
            {
                role: 'longDistanceHarvester',
                empty: true,
                home: home,
                target: target,
                sourceId: sourceId,
                dropMining: true,
                reserved: reservedRemote,
                workParts: workParts,
                moveParts: moveParts
            }
            });
        };
		StructureSpawn.prototype.createClaimer = 
		function (target, numbers, avoidRooms)
		{
		    if (avoidRooms != undefined)
		    {
		        return this.spawnCreep([CLAIM, MOVE, MOVE], numbers, {memory: {role: 'claimer', target: target, avoidRooms: avoidRooms}});
		    }
		    return this.spawnCreep([CLAIM, MOVE, MOVE], numbers, {memory: {role: 'claimer', target: target}});
		}
		StructureSpawn.prototype.createReserver =
		function (energy, target, numbers, avoidRooms)
		{
		    if (energy < 650)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var memory = {role: 'reserver', target: target, home: this.room.name};
		    if (avoidRooms != undefined)
		    {
		        memory.avoidRooms = avoidRooms;
		    }
		    // A reservation loses 1 tick per tick and each CLAIM adds 1, so one CLAIM
		    // only holds it in place. Two build a buffer that outlasts a spawn gap,
		    // and let the reserve-ticks gate skip spawning while it's high.
		    if (energy >= 1300)
		    {
		        return this.spawnCreep([CLAIM, CLAIM, MOVE, MOVE], numbers, {memory: memory});
		    }
		    return this.spawnCreep([CLAIM, MOVE], numbers, {memory: memory});
		}
		StructureSpawn.prototype.createControllerAttacker =
		function (energy, target, numbers, avoidRooms)
		{
		    var nParts = Math.floor(energy / 700);
		    if (nParts > 16)
		    {
		        nParts = 16;
		    }
		    if (nParts < 1)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i = 0; i < nParts; i++)
		    {
		        body.push(CLAIM);
		    }
		    for (let i = 0; i < nParts * 2; i++)
		    {
		        body.push(MOVE);
		    }
		    var memory = {role: 'controllerAttacker', target: target, targetRoom: target, home: this.room.name};
		    if (avoidRooms != undefined)
		    {
		        memory.avoidRooms = avoidRooms;
		    }
		    return this.spawnCreep(body, numbers, {memory: memory});
		}
		StructureSpawn.prototype.createAttacker = 
		function (energy, target, boosted, numbers, targetFlag, retreatRoom, avoidRooms, targetId, style)
		{
		    var body = [];
		    style = style || 'brawler';
		    if (style == 'raider')
		    {
		        // Fast solo raider: TOUGH + RANGED_ATTACK + HEAL + 3 MOVE.
		        // The extra MOVE lets it cross plains without building fatigue off roads.
		        var raiderParts = Math.floor(energy / 560);
		        if (raiderParts > 8)
		        {
		            raiderParts = 8;
		        }
		        if (raiderParts < 1)
		        {
		            return ERR_NOT_ENOUGH_ENERGY;
		        }
		        for (let i = 0; i < raiderParts; i++)
		        {
		            body.push(TOUGH);
		        }
		        for (let i = 0; i < raiderParts * 3; i++)
		        {
		            body.push(MOVE);
		        }
		        for (let i = 0; i < raiderParts; i++)
		        {
		            body.push(RANGED_ATTACK);
		        }
		        for (let i = 0; i < raiderParts; i++)
		        {
		            body.push(HEAL);
		        }
		    }
		    else
		    {
		        // Fast melee brawler: TOUGH + ATTACK + 2 MOVE bundles,
		        // plus one RANGED_ATTACK and one extra MOVE. This keeps MOVE parts
		        // equal to non-MOVE parts so it does not build fatigue on plains.
		        var brawlerParts = Math.floor((energy - 200) / 190);
		        if (brawlerParts > 12)
		        {
		            brawlerParts = 12;
		        }
		        if (brawlerParts < 1)
		        {
		            return ERR_NOT_ENOUGH_ENERGY;
		        }
		        for (let i=0; i<brawlerParts; i++)
		        {
		            body.push(TOUGH);
		        }
		        for (let i=0; i<brawlerParts * 2 + 1; i++)
		        {
		            body.push(MOVE);
		        }
		        for (let i=0; i<brawlerParts; i++)
		        {
		            body.push(ATTACK);
		        }
		        body.push(RANGED_ATTACK);
		    }
		    var wantsBoost = boosted == true;
		    var memory = {role: 'attacker', target: target, targetRoom: target, boosted: false, wantsBoost: wantsBoost, home: this.room.name, style: style};
		    if (wantsBoost)
		    {
		        memory.boostProfile = 'combatT3';
		        memory.wantsCombatBoosts = true;
		        memory.boostStrict = true;
		    }
		    if (targetFlag != undefined)
		    {
		        memory.targetFlag = targetFlag;
		    }
		    if (retreatRoom != undefined)
		    {
		        memory.retreatRoom = retreatRoom;
		    }
		    if (avoidRooms != undefined)
		    {
		        memory.avoidRooms = avoidRooms;
		    }
		    if (targetId != undefined)
		    {
		        memory.targetId = targetId;
		    }
		    return this.spawnCreep(body, numbers, {memory: memory});
		}
		// Remote guard: per 900-energy block 3 RANGED_ATTACK + 1 HEAL + 4 MOVE (full
		// speed off-road). HEAL sits last so it is the last part to break.
		StructureSpawn.prototype.createRemoteGuard =
		function (energy, request, numbers)
		{
		    var blocks = request && request.blocks > 0 ? request.blocks : 0;
		    if (!blocks || energy < blocks * 900)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i = 0; i < blocks * 2; i++) body.push(MOVE);
		    for (let i = 0; i < blocks * 3; i++) body.push(RANGED_ATTACK);
		    for (let i = 0; i < blocks * 2; i++) body.push(MOVE);
		    for (let i = 0; i < blocks; i++) body.push(HEAL);
		    return this.spawnCreep(body, numbers, {memory: {role: 'remoteGuard', target: request.room,
		        home: this.room.name, wantsCombatBoosts: true, boostStrict: request.boosted === true}});
		}
		// CARRY + MOVE pairs to haul a dead stronghold's loot home.
		StructureSpawn.prototype.createLooter =
		function (energy, home, targetRoom, distance, numbers)
		{
		    var pairs = Math.min(25, Math.floor(energy / 100));
		    if (pairs < 5)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i = 0; i < pairs; i++)
		    {
		        body.push(CARRY);
		    }
		    for (let i = 0; i < pairs; i++)
		    {
		        body.push(MOVE);
		    }
		    var returnTicks = 60 * Math.max(1, distance || 1) + 60;
		    return this.spawnCreep(body, numbers, {memory: {role: 'looter', home: home, target: targetRoom,
		        returnTicks: returnTicks}});
		}
		// Plain ATTACK + MOVE pairs for a level-0 Invader core: it never shoots back,
		// so no TOUGH or HEAL. Aim to finish in ~300 ticks (every tick alive keeps
		// its reservation growing), but accept anything that finishes in ~1000.
		StructureSpawn.prototype.createCoreBreaker =
		function (energy, targetRoom, targetId, coreHits, numbers)
		{
		    var attackPower = typeof ATTACK_POWER == 'number' ? ATTACK_POWER : 30;
		    var hits = coreHits > 0 ? coreHits : 100000;
		    var wantedPairs = Math.min(25, Math.ceil(hits / (attackPower * 300)));
		    var minPairs = Math.min(25, Math.ceil(hits / (attackPower * 1000)));
		    var capacityPairs = Math.floor(this.room.energyCapacityAvailable / 130);
		    var pairs = Math.min(wantedPairs, capacityPairs);
		    if (pairs < minPairs || energy < pairs * 130)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i = 0; i < pairs; i++)
		    {
		        body.push(MOVE);
		    }
		    for (let i = 0; i < pairs; i++)
		    {
		        body.push(ATTACK);
		    }
		    var memory = {role: 'attacker', target: targetRoom, targetRoom: targetRoom, targetId: targetId,
		        invaderCoreRoom: targetRoom, home: this.room.name, style: 'coreBreaker',
		        boosted: false, wantsBoost: false, retreatOnDamage: false};
		    return this.spawnCreep(body, numbers, {memory: memory});
		}
		StructureSpawn.prototype.createQuadMember =
		function (energy, squad, slot, targetRoom, targetFlag, retreatRoom, numbers, options)
		{
		    // One bundle costs 560: TOUGH + RANGED_ATTACK + HEAL + 3 MOVE.
		    // Three MOVE parts carry the three non-MOVE parts across plains every tick.
		    // The full profile is 9 TOUGH, 25 MOVE, 8 RANGED_ATTACK, and 8 HEAL:
		    // exactly 50 parts with no wasted MOVE capacity on plains.
		    var nParts = Math.floor(energy / 560);
		    if (nParts > 8)
		    {
		        nParts = 8;
		    }
		    if (nParts < 1)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i = 0; i < nParts; i++)
		    {
		        body.push(TOUGH);
		    }
		    // Fill the final 50th slot with durable front armor, not surplus MOVE.
		    // The paired MOVE below keeps the body at 25 MOVE / 25 non-MOVE.
		    if (nParts == 8 && energy >= 4540)
		    {
		        body.push(TOUGH);
		    }
		    // Keep all MOVE parts at the end of the body. After the TOUGH armor is
		    // depleted, combat parts absorb damage before movement capacity does.
		    for (let i = 0; i < nParts; i++)
		    {
		        body.push(RANGED_ATTACK);
		    }
		    for (let i = 0; i < nParts; i++)
		    {
		        body.push(HEAL);
		    }
		    for (let i = 0; i < nParts * 3; i++)
		    {
		        body.push(MOVE);
		    }
		    if (nParts == 8 && energy >= 4540)
		    {
		        body.push(MOVE);
		    }

		    options = options || {};
		    var memory = {
		        role: 'quad',
		        squad: squad,
		        slot: slot,
		        targetRoom: targetRoom,
		        targetFlag: targetFlag,
		        retreatRoom: retreatRoom,
		        home: this.room.name,
		        origin: this.room.name,
		        boosted: false,
		        boostMode: options.boostMode || 'never',
		        nParts: nParts
		    };
		    if (options.rallyRoom != undefined)
		    {
		        memory.rallyRoom = options.rallyRoom;
		    }
		    if (options.rallyFlag != undefined)
		    {
		        memory.rallyFlag = options.rallyFlag;
		    }
		    if (options.rallyPos != undefined)
		    {
		        memory.rallyPos = options.rallyPos;
		    }
		    if (options.wantsCombatBoosts == true)
		    {
		        memory.boostProfile = 'combatT3';
		        memory.wantsCombatBoosts = true;
		        memory.boostStrict = options.boostStrict == true;
		    }
		    else
		    {
		        memory.wantsCombatBoosts = false;
		        memory.boostStrict = false;
		    }
		    return this.spawnCreep(body, numbers, {memory: memory});
		}
		StructureSpawn.prototype.createMiner = 
		function (sourceId, numbers)
		{
		    return this.spawnCreep([WORK, WORK, WORK, WORK, WORK, WORK, MOVE], numbers, {
		        memory:
		    {role: 'miner', sourceId: sourceId, home: this.room.name}
		    });
		}
	StructureSpawn.prototype.createLorry =
        function(energy, role, numbers)
        {
            var nParts = Math.floor(energy / 150);
            if (nParts > 16)
            {
                nParts = 16;
            }
            if (nParts < 1)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }
            var body = [];
            for (let i = 0; i< nParts*2; i++)
            {
                body.push(CARRY);
            }
            for (let i = 0; i< nParts; i++)
            {
                body.push(MOVE);
            }
            return this.spawnCreep(body, numbers, {
                memory:
            {role: role, empty: true, home: this.room.name}
            });
        };
        StructureSpawn.prototype.createRemoteLorry =
        function(energy, home, target, sourceId, numbers)
        {
            // Keep remote haulers from growing into oversized 30-50 part creeps.
            // 10 CARRY + 10 MOVE costs 1000 energy, carries 500 energy,
            // and fits the current one-source E9S17 remote better than
            // spawning the largest affordable hauler every time.
            var maxRemoteLorryPairs = 10;
            var nParts = Math.floor(energy / 100);
            if (nParts > maxRemoteLorryPairs)
            {
                nParts = maxRemoteLorryPairs;
            }
            if (nParts < 1)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }
            var body = [];
            for (let i = 0; i < nParts; i++)
            {
                body.push(CARRY);
                body.push(MOVE);
            }
            return this.spawnCreep(body, numbers, {
                memory:
            {role: 'remoteLorry', empty: true, home: home, target: target, sourceId: sourceId}
            });
        };
        function normalizeRemoteBuildBodyProfile(bodyProfile)
        {
            return bodyProfile == 'roaded' ? 'roaded' : 'offroad';
        }
        function pushBodyParts(body, part, count)
        {
            for (let i = 0; i < count; i++)
            {
                body.push(part);
            }
        }
        function getRemoteCarrierBodyParts(energy, bodyProfile)
        {
            bodyProfile = normalizeRemoteBuildBodyProfile(bodyProfile);
            var roaded = bodyProfile == 'roaded';
            if (roaded)
            {
                for (let carryParts = 33; carryParts >= 1; carryParts--)
                {
                    let moveParts = Math.ceil(carryParts / 2);
                    if (carryParts + moveParts <= 50
                        && (carryParts + moveParts) * 50 <= energy)
                    {
                        while (moveParts < carryParts
                            && carryParts + moveParts < 50
                            && (carryParts + moveParts + 1) * 50 <= energy)
                        {
                            moveParts++;
                        }
                        return {carryParts: carryParts, moveParts: moveParts};
                    }
                }
                return undefined;
            }

            var nPairs = Math.floor(energy / 100);
            if (nPairs > 25)
            {
                nPairs = 25;
            }
            if (nPairs < 1)
            {
                return undefined;
            }
            return {carryParts: nPairs, moveParts: nPairs};
        }
        function getRemoteBuilderBodyParts(energy, bodyProfile)
        {
            bodyProfile = normalizeRemoteBuildBodyProfile(bodyProfile);
            var roaded = bodyProfile == 'roaded';
            var best = undefined;
            for (let workParts = 1; workParts <= 49; workParts++)
            {
                let minCarryParts = Math.max(1, Math.ceil(workParts / (roaded ? 3 : 2)));
                for (let carryParts = minCarryParts; carryParts <= 49 - workParts; carryParts++)
                {
                    let moveParts = roaded
                        ? Math.ceil((workParts + carryParts) / 2)
                        : workParts + carryParts;
                    let partCount = workParts + carryParts + moveParts;
                    let cost = workParts * 100 + carryParts * 50 + moveParts * 50;
                    if (partCount > 50 || cost > energy)
                    {
                        continue;
                    }
                    if (!best
                        || workParts > best.workParts
                        || (workParts == best.workParts && carryParts > best.carryParts)
                        || (workParts == best.workParts && carryParts == best.carryParts && cost > best.cost))
                    {
                        best = {
                            workParts: workParts,
                            carryParts: carryParts,
                            moveParts: moveParts,
                            cost: cost
                        };
                    }
                }
            }
            if (!best)
            {
                return undefined;
            }
            while (best.workParts + best.carryParts + best.moveParts < 50
                && best.cost + 50 <= energy)
            {
                best.moveParts++;
                best.cost += 50;
            }
            return best;
        }
        function makeRemoteBuildMemory(role, home, target, mission, depotPos, avoidRooms, bodyProfile)
        {
            var memory = {
                role: role,
                remoteBuildMission: mission,
                home: home,
                target: target,
                empty: true,
                bodyProfile: normalizeRemoteBuildBodyProfile(bodyProfile)
            };
            if (depotPos != undefined)
            {
                memory.depotPos = {
                    x: depotPos.x,
                    y: depotPos.y,
                    roomName: depotPos.roomName || target
                };
                if (typeof depotPos.flagName == 'string')
                {
                    memory.depotFlag = depotPos.flagName;
                }
            }
            if (avoidRooms != undefined)
            {
                memory.avoidRooms = avoidRooms;
            }
            return memory;
        }
        StructureSpawn.prototype.createRemoteCarrier =
        function(energy, home, target, mission, depotPos, avoidRooms, numbers, bodyProfile)
        {
            var parts = getRemoteCarrierBodyParts(energy, bodyProfile);
            if (!parts)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }
            var body = [];
            pushBodyParts(body, CARRY, parts.carryParts);
            pushBodyParts(body, MOVE, parts.moveParts);
            return this.spawnCreep(body, numbers, {
                memory: makeRemoteBuildMemory('remoteCarrier', home, target, mission, depotPos, avoidRooms, bodyProfile)
            });
        };
        StructureSpawn.prototype.createRemoteBuilder =
        function(energy, home, target, mission, depotPos, avoidRooms, numbers, bodyProfile)
        {
            var parts = getRemoteBuilderBodyParts(energy, bodyProfile);
            if (!parts)
            {
                return ERR_NOT_ENOUGH_ENERGY;
            }
            var body = [];
            pushBodyParts(body, WORK, parts.workParts);
            pushBodyParts(body, CARRY, parts.carryParts);
            pushBodyParts(body, MOVE, parts.moveParts);
            return this.spawnCreep(body, numbers, {
                memory: makeRemoteBuildMemory('remoteBuilder', home, target, mission, depotPos, avoidRooms, bodyProfile)
            });
        };
    StructureSpawn.prototype.createDefender = 
		function (energy, target, numbers)
		{
		    var nParts = Math.min(Math.floor(energy/260), 12);
		    if (nParts < 1)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i=0; i<nParts; i++)
		    {
		        body.push(TOUGH);
		    }
		    for (let i=0; i<nParts * 2; i++)
		    {
		        body.push(MOVE);
		    }
		    for (let i=0; i<nParts; i++)
		    {
		        body.push(RANGED_ATTACK);
		    }
		    var memory = {
		        role: 'defender',
		        target: target,
		        home: this.room.name,
		        boosted: false,
		        boostProfile: 'combatT3',
		        wantsCombatBoosts: true,
		        boostStrict: false
		    };
		    return this.spawnCreep(body, numbers, {memory: memory});
		};
	StructureSpawn.prototype.createHealer =
		function (energy, target, numbers, avoidRooms)
		{
		    var nParts = Math.min(Math.floor(energy/300), 25);
		    if (nParts < 1)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i=0; i<nParts; i++)
		    {
		        body.push(MOVE);
		    }
		    for (let i=0; i<nParts; i++)
		    {
		        body.push(HEAL);
		    }
		    var memory = {
		        role: 'healer',
		        target: target,
		        home: this.room.name,
		        boosted: false,
		        boostProfile: 'combatT3',
		        wantsCombatBoosts: true,
		        boostStrict: false
		    };
		    // Travel the same way as the attackers it supports.
		    if (avoidRooms != undefined)
		    {
		        memory.avoidRooms = avoidRooms;
		    }
		    return this.spawnCreep(body, numbers, {memory: memory});
		};
		StructureSpawn.prototype.createSLinker =
		function (sourceId, numbers)
		{
		    return this.spawnCreep([WORK, WORK, WORK, WORK, WORK, CARRY, MOVE], numbers, {memory:
		    {role: 'Slinker', empty: true, home: this.room.name, sourceId: sourceId}
		    });
		};

		StructureSpawn.prototype.createLinker = 
		function (energy, roleName, flag, numbers)
		{
		    var nParts = Math.min(Math.floor(energy/350), 10);
		    if (nParts < 1)
		    {
		        return ERR_NOT_ENOUGH_ENERGY;
		    }
		    var body = [];
		    for (let i=0; i<nParts * 2; i++)
		    {
		        body.push(WORK);
		    }
		    for (let i=0; i<nParts * 2; i++)
		    {
		        body.push(CARRY);
		    }
		    for (let i=0; i<nParts; i++)
		    {
		        body.push(MOVE);
		    }
		    return this.spawnCreep(body, numbers, {memory:
		    {role: roleName, empty: true, flag: flag, home: this.room.name}
		    });
		};
		
	StructureSpawn.prototype.createMinerallorry =
	    function(energy, role, mineralType, numbers, labId, sourceContainerId, specialStructureId, specialStructureType)
	    {
	        var nParts = Math.floor(energy / 150);
	        if (nParts > 16)
	        {
	            nParts = 16;
	        }
	        if (nParts < 1)
	        {
	            return ERR_NOT_ENOUGH_ENERGY;
	        }
	        var body = [];
            for (let i = 0; i< nParts*2; i++)
            {
                body.push(CARRY);
            }
            for (let i = 0; i< nParts; i++)
            {
                body.push(MOVE);
            }
            var memory = {role: role, empty: true, mineralType: mineralType, home: this.room.name};
            if (labId != undefined)
            {
                memory.labId = labId;
            }
            if (sourceContainerId != undefined)
            {
                memory.sourceContainerId = sourceContainerId;
            }
            if (specialStructureId != undefined)
            {
                memory.specialStructureId = specialStructureId;
            }
            if (specialStructureType != undefined)
            {
                memory.specialStructureType = specialStructureType;
            }
            return this.spawnCreep(body, numbers, {memory: memory});
	        };
};