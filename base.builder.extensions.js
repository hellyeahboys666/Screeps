// Non-destructive, CPU-bounded extension reservations; executor handles current RCL caps.
function index(x,y) { return y*50+x; }
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function range(a,b) { return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); }
function passable(t) { return t === 'road' || t === 'rampart' || t === 'container'; }
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
    var ownedCount = existing.filter(o => o.type === 'extension' && o.my).length;
    var target = Math.max(0, Math.min(60, Number.isInteger(requested) ? requested : 60) - ownedCount);
    var occupied = new Set(existing.concat(seed, input.sources,
        input.minerals || [], [input.controller, input.anchor]).map(o => index(o.pos.x,o.pos.y)));
    var blocked = new Set(existing.concat(seed).filter(o => !passable(o.type)).map(o => index(o.pos.x,o.pos.y)));
    var road = existing.concat(seed).filter(o => o.type === 'road').map(o => o.pos);
    var goals = seed.filter(o => o.type === 'container').map(o => o.pos);
    var result = [];
    function reachable() {
        var start = input.anchor.pos, seen = new Uint8Array(2500), queue = [start];
        seen[index(start.x,start.y)] = 1;
        for (var h=0;h<queue.length;h++) {
            var p=queue[h];
            for (var dy=-1;dy<=1;dy++) for (var dx=-1;dx<=1;dx++) {
                if (!dx && !dy) continue;
                var x=p.x+dx,y=p.y+dy,i=index(x,y);
                if (x<1 || x>48 || y<1 || y>48 || seen[i] || input.terrain[i] === 1 || blocked.has(i)) continue;
                seen[i]=1; queue.push({x,y});
            }
        }
        for (var goal of goals) if (!seen[index(goal.x,goal.y)]) return false;
        var work = false;
        for (var p of queue) if (range(p,input.controller.pos)<=3) {work=true;break;}
        return work;
    }
    if (!reachable()) return {entries:[],blockers:['initialTargetsDisconnected']};
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
        blocked.add(i);
        if (!reachable()) {blocked.delete(i);continue;}
        result.push({type:'extension',purpose:'extension:'+(ownedCount+result.length),pos:p,priority:50});
    }
    return {entries:result,blockers:result.length<target ? ['insufficientAccessibleSpace'] : []};
}
module.exports={planExtensions};
