// Non-destructive, CPU-bounded extension reservations; executor handles current RCL caps.
var access = require('base.builder.access');
function index(x,y) { return y*50+x; }
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function range(a,b) { return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); }

function planExtensions(input, seed, requested) {
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
    var candidates=[];
    for (var y=2;y<=47;y++) for (var x=2;x<=47;x++) {
        var p={x,y}, i=index(x,y), d=range(p,input.anchor.pos);
        if (input.terrain[i] === 1 || occupied.has(i) || d > 15
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
        var nearestRoad = road.length ? Math.min.apply(null,road.map(r => range(p,r))) : 3;
        candidates.push({pos:p, score:d*10 + Math.min(nearestRoad,4)*3});
    }
    candidates.sort((a,b) => a.score-b.score || a.pos.y-b.pos.y || a.pos.x-b.pos.x);
    for (var candidate of candidates) {
        if (result.length >= target) break;
        var p=candidate.pos,i=index(p.x,p.y);
        var entry={type:'extension',purpose:'extension:'+(ownedCount+result.length),pos:p,priority:50};
        blocked.add(i);
        if (guard.check(seed.concat(result, entry), access.flood(input, blocked))) {blocked.delete(i);continue;}
        result.push(entry);
    }
    return {entries:result,blockers:result.length<target ? ['insufficientAccessibleSpace'] : []};
}
module.exports={planExtensions};
