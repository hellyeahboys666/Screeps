// Conservative, deterministic layout seed around a built spawn. Planning does no game writes.
function index(x, y) { return y * 50 + x; }
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function key(p) { return index(p.x, p.y); }
function interior(p) { return p.x >= 2 && p.x <= 47 && p.y >= 2 && p.y <= 47; }

function obstacles(input, entries) {
    var blocked = new Set();
    for (var obj of input.structures.concat(input.sites)) {
        if (obj.type !== 'road' && obj.type !== 'container' && obj.type !== 'rampart') blocked.add(key(obj.pos));
    }
    for (var obj of entries) {
        if (obj.type !== 'container' && obj.type !== 'road' && obj.type !== 'rampart') blocked.add(key(obj.pos));
    }
    return blocked;
}

function flood(input, blocked) {
    // Don't path through exits; they can lead to a different room rather than around a wall.
    var reachable = new Uint8Array(2500);
    var queue = [input.anchor.pos];
    reachable[key(input.anchor.pos)] = 1;
    for (var head = 0; head < queue.length; head++) {
        var from = queue[head];
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var x = from.x + dx, y = from.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            var i = index(x, y);
            if (reachable[i] || input.terrain[i] || blocked.has(i)) continue;
            reachable[i] = 1;
            queue.push({x: x, y: y});
        }
    }
    return reachable;
}

function clearance(input, blocked) {
    // Chebyshev distance transform: min over all 8 neighbors, no unbounded pathfinder.
    var distance = new Uint8Array(2500);
    for (var y = 1; y < 49; y++) for (var x = 1; x < 49; x++) {
        var i = index(x, y);
        if (!input.terrain[i] && !blocked.has(i)) distance[i] = 49;
    }
    for (var y = 1; y < 49; y++) for (var x = 1; x < 49; x++) {
        var i = index(x, y);
        if (!distance[i]) continue;
        distance[i] = Math.min(distance[i], 1 + distance[i - 1], 1 + distance[i - 50], 1 + distance[i - 49], 1 + distance[i - 51]);
    }
    for (var y = 48; y >= 1; y--) for (var x = 48; x >= 1; x--) {
        var i = index(x, y);
        if (!distance[i]) continue;
        distance[i] = Math.min(distance[i], 1 + distance[i + 1], 1 + distance[i + 50], 1 + distance[i + 49], 1 + distance[i + 51]);
    }
    return distance;
}

function plan(input) {
    var bad = {valid: false, reason: 'invalidSnapshot', entries: [], blockers: ['invalidSnapshot']};
    if (!input || !input.eligible || !valid(input.anchor && input.anchor.pos)
        || !valid(input.controller && input.controller.pos)
        || !Array.isArray(input.terrain) || input.terrain.length !== 2500
        || !Array.isArray(input.sources) || !Array.isArray(input.structures)
        || !Array.isArray(input.sites) || !Array.isArray(input.spawns)
        || !input.sources.every(function(s) { return valid(s.pos); })
        || !input.structures.concat(input.sites, input.spawns).every(function(o) { return o && valid(o.pos); })) return bad;
    var entries = [], blockers = [];
    var taken = new Set(input.structures.concat(input.sites, input.spawns, input.sources, [input.controller])
        .map(function(o) { return key(o.pos); }));
    for (var mineral of input.minerals || []) {
        if (!valid(mineral.pos)) return bad;
        taken.add(key(mineral.pos));
    }
    var blocks = obstacles(input, entries);
    var reachable = flood(input, blocks);
    var clear = clearance(input, blocks);
    function nearSource(pos) { return input.sources.some(function(s) { return range(pos, s.pos) <= 1; }); }
    function add(type, purpose, pos, priority) {
        entries.push({type: type, purpose: purpose, pos: {x: pos.x, y: pos.y}, priority: priority});
        taken.add(key(pos));
    }
    function candidates(predicate, score) {
        var choices = [];
        for (var y = 2; y < 48; y++) for (var x = 2; x < 48; x++) {
            var pos = {x: x, y: y}, i = index(x, y);
            if (input.terrain[i] || taken.has(i) || !reachable[i] || !predicate(pos)) continue;
            choices.push({pos: pos, score: score(pos, i)});
        }
        choices.sort(function(a, b) { return a.score - b.score || a.pos.y - b.pos.y || a.pos.x - b.pos.x; });
        return choices;
    }
    var sources = input.sources.slice().sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
    for (var source of sources) {
        var hasContainer = input.structures.concat(input.sites).some(function(o) {
            return o.type === 'container' && range(o.pos, source.pos) <= 1;
        });
        if (hasContainer) continue;
        var choice = candidates(function(p) { return range(p, source.pos) === 1; },
            function(p) { return range(p, input.anchor.pos) * 10 - clear[key(p)]; })[0];
        if (choice) add('container', 'source:' + source.id, choice.pos, 10);
        else blockers.push('noReachableSourceSeat:' + source.id);
    }
    var controllerBuffer = input.structures.concat(input.sites).some(function(o) {
        return o.type === 'container' && range(o.pos, input.controller.pos) <= 3;
    });
    if (!controllerBuffer) {
        var upgrade = candidates(function(p) {
            return range(p, input.controller.pos) >= 1 && range(p, input.controller.pos) <= 3 && !nearSource(p);
        }, function(p) { return range(p, input.anchor.pos) * 10 + range(p, input.controller.pos); })[0];
        if (upgrade) add('container', 'controllerBuffer', upgrade.pos, 20);
        else blockers.push('noControllerBufferSeat');
    }
    // Core additions must not consume source seats or existing/manual structures.
    var hasStorage = input.structures.concat(input.sites).some(function(o) { return o.type === 'storage'; });
    if (!hasStorage) {
        var storage = candidates(function(p) {
            return range(p, input.anchor.pos) >= 2 && range(p, input.anchor.pos) <= 6 && !nearSource(p);
        }, function(p, i) {
            return range(p, input.anchor.pos) * 20 + range(p, input.controller.pos) * 2 - Math.min(clear[i], 5) * 4;
        })[0];
        if (storage) add('storage', 'coreStorage', storage.pos, 40);
        else blockers.push('noCoreStorageSite');
    }
    // A current tower (or manually queued tower) takes precedence over any new plan.
    var hasTower = input.structures.concat(input.sites).some(function(o) { return o.type === 'tower'; });
    if (!hasTower) {
        var tower = candidates(function(p) {
            return range(p, input.anchor.pos) <= 7 && !nearSource(p);
        }, function(p, i) { return range(p, input.anchor.pos) * 10 - Math.min(clear[i], 5) * 2; })[0];
        if (tower) add('tower', 'coreTower', tower.pos, 30);
        else blockers.push('noCoreTowerSite');
    }
    // Verify planned obstacle structures haven't sealed any mining/controller access.
    var after = flood(input, obstacles(input, entries));
    for (var source of sources) {
        var seats = entries.filter(function(e) { return e.purpose === 'source:' + source.id; });
        if (seats.length && !after[key(seats[0].pos)]) blockers.push('blockedSourceSeat:' + source.id);
    }
    if (!Array.from({length: 2500}, function(_, i) {
        return after[i] && range({x: i % 50, y: Math.floor(i / 50)}, input.controller.pos) <= 3;
    }).some(Boolean)) blockers.push('noReachableUpgradePosition');
    return {valid: blockers.length === 0, anchorId: input.anchor.id, entries: entries, blockers: blockers};
}
module.exports = {plan: plan};
