// Non-destructive, CPU-bounded extension reservations; executor handles current RCL caps.
var access = require('base.builder.access');
function index(x,y) { return y*50+x; }
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function range(a,b) { return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); }

function planExtensions(input, seed, requested, options) {
    options = options || {};
    var failed = {entries:[],blockers:['invalidSnapshot']};
    if (!input || !input.eligible || !valid(input.anchor && input.anchor.pos)
        || !valid(input.controller && input.controller.pos)
        || !Array.isArray(input.terrain) || input.terrain.length !== 2500
        || !Array.isArray(input.sources) || !Array.isArray(input.structures)
        || !Array.isArray(input.sites) || !Array.isArray(seed)
        || !Array.isArray(input.minerals || [])
        || !input.structures.concat(input.sites, seed, input.sources, input.minerals || [])
            .every(o => o && valid(o.pos))) return failed;
    var existing = input.structures.concat(input.sites);
    var ownedCount = existing.concat(seed).filter(o => o.type === 'extension' && o.my !== false).length;
    var target = Math.max(0, Math.min(60, Number.isInteger(requested) ? requested : 60) - ownedCount);
    var occupied = new Set(existing.concat(seed, input.sources,
        input.minerals || [], [input.controller, input.anchor]).map(o => index(o.pos.x,o.pos.y)));
    var blocked = access.obstacles(input, seed), guard = access.create(input);
    var road = existing.concat(seed).filter(o => o.type === 'road').map(o => o.pos);
    var result = [];
    if (guard.check(seed)) return {entries:[],blockers:['initialTargetsDisconnected']};
    // Rank by walking distance from the storage (where fillers load), not by
    // straight-line range from the spawn: walls make range a poor proxy.
    var hub = access.hubOf(input, seed);
    var walk = hub ? access.walkDistance(input, blocked, hub) : null;
    // Range to the nearest road, capped at 4: one pass over the roads instead of
    // a scan of every road for every candidate tile.
    var roadNear = new Uint8Array(2500).fill(4);
    for (var r of road) for (var ry = Math.max(0, r.y - 3); ry <= Math.min(49, r.y + 3); ry++)
        for (var rx = Math.max(0, r.x - 3); rx <= Math.min(49, r.x + 3); rx++) {
            var rr = Math.max(Math.abs(rx - r.x), Math.abs(ry - r.y));
            if (rr < roadNear[ry * 50 + rx]) roadNear[ry * 50 + rx] = rr;
        }
    var exitBand = access.nearExit(input);
    var candidates=[];
    var parity = hub ? (hub.x + hub.y + 1) & 1 : (input.anchor.pos.x + input.anchor.pos.y) & 1;
    // Layouts. 'grid' (default): diagonal road lanes every 4 tiles in both directions,
    // crossing at the storage, with plus-shaped extension fields between them
    // (10 of every 16 tiles; every extension touches a lane). 'checker': extensions on
    // one checkerboard colour (8 of 16), the other colour left as unpaved lanes.
    var grid = options.layout !== 'checker';
    var lane = access.laneOf(hub || input.anchor.pos, grid ? 'grid' : 'checker');
    for (var y=2;y<=47;y++) for (var x=2;x<=47;x++) {
        var p={x,y}, i=index(x,y), d=walk ? walk[i] : range(p,input.anchor.pos);
        if (input.terrain[i] === 1 || occupied.has(i) || exitBand[i] || d > (walk ? 25 : 15)
            || input.sources.some(s => range(p,s.pos)<=1)
            || range(p,input.controller.pos)<=3) continue;
        // A one-tile corridor is an access lane, not extension space.
        var neighbors=0;
        for (var dy=-1;dy<=1;dy++) for (var dx=-1;dx<=1;dx++) {
            if (!dx && !dy) continue;
            var n=index(x+dx,y+dy);
            if (x+dx>1 && x+dx<48 && y+dy>1 && y+dy<48
                && input.terrain[n] !== 1 && !blocked.has(n)) neighbors++;
        }
        if (neighbors < 4) continue;
        var nearestRoad = road.length ? roadNear[i] : 3;
        // Checkerboard: extensions on one tile colour keep the other colour free
        // as walking lanes, so packing the nearest tiles never strands later ones.
        var offGrid = grid ? (lane(x, y) ? 1000 : 0) : (((x + y) & 1) !== parity ? 1000 : 0);
        candidates.push({pos:p, score:offGrid + d*10 + Math.min(nearestRoad,4)*3});
    }
    candidates.sort((a,b) => a.score-b.score || a.pos.y-b.pos.y || a.pos.x-b.pos.x);
    for (var candidate of candidates) {
        if (result.length >= target) break;
        var p=candidate.pos,i=index(p.x,p.y);
        var entry={type:'extension',purpose:'extension:'+(ownedCount+result.length),pos:p,priority:50};
        blocked.add(i);
        if (guard.check(seed.concat(result, entry), access.flood(input, blocked, hub))) {blocked.delete(i);continue;}
        result.push(entry);
    }
    var lanes = [];
    if (grid && result.length) {
        // Pave the lanes serving the new extensions, but only along lane tiles that
        // connect back to an existing/planned road, so every new road
        // joins the network (isolated lane pieces stay unpaved walkways).
        var taken = new Set(occupied);
        for (var e of result) taken.add(index(e.pos.x, e.pos.y));
        var free = function(i) {
            var lx = i % 50, ly = (i - lx) / 50;
            return lx >= 1 && lx <= 48 && ly >= 1 && ly <= 48 && lane(lx, ly)
                && input.terrain[i] !== 1 && !taken.has(i) && !blocked.has(i);
        };
        var paved = new Set(existing.concat(seed).filter(o => o.type === 'road').map(o => index(o.pos.x, o.pos.y)));
        var parent = new Map(), queue = [];
        for (var i = 0; i < 2500; i++) {
            if (!free(i)) continue;
            var ix = i % 50, iy = (i - ix) / 50, start = false;
            for (var dy=-1;dy<=1 && !start;dy++) for (var dx=-1;dx<=1;dx++) {
                var ni = index(ix + dx, iy + dy);
                if ((dx || dy) && paved.has(ni)) { start = true; break; }
            }
            if (start) { parent.set(i, -1); queue.push(i); }
        }
        for (var h = 0; h < queue.length; h++) {
            var c = queue[h], cx = c % 50, cy = (c - cx) / 50;
            for (var dy=-1;dy<=1;dy++) for (var dx=-1;dx<=1;dx++) {
                var n = index(cx + dx, cy + dy);
                if ((dx || dy) && !parent.has(n) && free(n)) { parent.set(n, c); queue.push(n); }
            }
        }
        var pave = new Set();
        for (var e of result) for (var dy=-1;dy<=1;dy++) for (var dx=-1;dx<=1;dx++) {
            var li = index(e.pos.x + dx, e.pos.y + dy);
            if ((dx || dy) && parent.has(li)) for (var step = li; step !== -1 && !pave.has(step); step = parent.get(step)) pave.add(step);
        }
        for (var li of Array.from(pave).sort(function(a, b) { return a - b; })) {
            lanes.push({type:'road', purpose:'extensionLane', pos:{x: li % 50, y: Math.floor(li / 50)}, priority:72});
        }
    }
    return {entries:result.concat(lanes),blockers:result.length<target ? ['insufficientAccessibleSpace'] : []};
}
module.exports={planExtensions};
