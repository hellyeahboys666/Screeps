// Deterministic, bounded road connectors for current and future logistics.
function index(x, y) { return y * 50 + x; }
function posKey(p) { return index(p.x, p.y); }
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function isPassable(type) { return type === 'road' || type === 'container' || type === 'rampart'; }
function connectRoads(input, seed) {
    if (!input || !input.eligible || !input.anchor || !valid(input.anchor.pos)
        || !Array.isArray(input.terrain) || input.terrain.length !== 2500
        || !Array.isArray(input.structures) || !Array.isArray(input.sites)
        || !Array.isArray(seed)) return {entries: [], blockers: ['invalidSnapshot']};
    var occupied = new Set(), blocked = new Set(), containers = new Set(), paved = new Set();
    for (var o of input.structures.concat(input.sites, seed)) {
        if (!valid(o.pos)) return {entries: [], blockers: ['invalidObjectPosition']};
        if (o.type === 'road' || o.type === 'container') occupied.add(posKey(o.pos));
        if (o.type === 'container') containers.add(posKey(o.pos));
        if (o.type === 'road') paved.add(posKey(o.pos));
        if (!isPassable(o.type)) blocked.add(posKey(o.pos));
        if (o.type === 'rampart' && o.my === false) blocked.add(posKey(o.pos));
    }
    for (var target of input.sources.concat(input.controller ? [input.controller] : [], input.minerals || [])) {
        if (!valid(target.pos)) return {entries: [], blockers: ['invalidTargetPosition']};
        blocked.add(posKey(target.pos));
    }
    var entries = [], blockers = [];
    var goals = [], goalKeys = new Set();
    for (var o of input.structures.concat(input.sites, input.spawns || [], seed,
        input.sources, input.controller ? [input.controller] : [])) {
        var type = o.type || (o === input.controller ? 'controller' : 'source');
        if (['container', 'spawn', 'source', 'controller', 'storage'].indexOf(type) === -1) continue;
        var id = type + ':' + posKey(o.pos);
        if (goalKeys.has(id)) continue;
        goalKeys.add(id);
        goals.push({pos: o.pos, radius: type === 'container' ? 0 : type === 'controller' ? 3 : 1,
            purpose: o.purpose || type + ':' + (o.id || posKey(o.pos)),
            anchor: type === 'spawn' && posKey(o.pos) === posKey(input.anchor.pos),
            priority: type === 'spawn' ? 0 : o.priority || 70});
    }
    goals.sort(function(a, b) {
        return a.priority - b.priority || String(a.purpose).localeCompare(String(b.purpose));
    });
    function route(goal) {
        var start = input.anchor.pos;
        var seen = new Uint8Array(2500), parent = new Int16Array(2500);
        var queue = [posKey(start)], startI = posKey(start), endI = -1;
        seen[startI] = 1;
        // Eight-way flood fill, bounded to the room; exit tiles are not valid detours.
        for (var head = 0; head < queue.length; head++) {
            var i = queue[head], x = i % 50, y = Math.floor(i / 50);
            if (i !== startI && range({x: x, y: y}, goal.pos) <= goal.radius
                && (!goal.anchor || !containers.has(i) || paved.has(i))) { endI = i; break; }
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                var nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                var n = index(nx, ny);
                if (seen[n] || (input.terrain[n] === 1 && !paved.has(n)) || blocked.has(n)) continue;
                seen[n] = 1;
                parent[n] = i;
                queue.push(n);
            }
        }
        if (endI === -1) return false;
        for (var step = endI; step !== startI; step = parent[step]) {
            if (occupied.has(step)) continue;
            var p = {x: step % 50, y: Math.floor(step / 50)};
            entries.push({type: 'road', purpose: 'path:' + goal.purpose, pos: p, priority: 70});
            occupied.add(step);
            paved.add(step);
        }
        return true;
    }
    for (var goal of goals) {
        if (!valid(goal.pos) || !route(goal)) blockers.push('unreachableRoadTarget:' + goal.purpose);
    }
    // Shared path steps may belong to several routes: stable order for plan replay.
    entries.sort(function(a, b) { return a.pos.y - b.pos.y || a.pos.x - b.pos.x; });
    return {entries: entries, blockers: blockers};
}
module.exports = {connectRoads: connectRoads};
