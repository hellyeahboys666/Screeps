'use strict';
const access = require('base.builder.access');
// Optional, non-destructive RCL7/8 reservations. Actual per-RCL legality is
// checked from CONTROLLER_STRUCTURES by the executor on every placement tick.
const TARGETS = [
    {type:'spawn', count:3, priority:82, near:8},
    {type:'tower', count:6, priority:78, near:14},
    {type:'factory', count:1, priority:120, near:9},
    {type:'powerSpawn', count:1, priority:130, near:9},
    {type:'observer', count:1, priority:140, near:12},
    {type:'nuker', count:1, priority:150, near:10}
];
// No filler containers/links: the bot only uses source, controller, base and
// mineral containers and source/controller/base links (see infrastructure).
function valid(p) {return !!p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x>=0 && p.x<50 && p.y>=0 && p.y<50;}
function idx(p) {return p.y*50+p.x;}
function range(a,b) {return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));}

function planExpansion(input,seed,limits) {
    const invalid={entries:[],blockers:['invalidExpansionInput']};
    if(!input||input.eligible!==true||!input.anchor||!valid(input.anchor.pos)
        ||!input.controller||!valid(input.controller.pos)
        ||!Array.isArray(input.terrain)||input.terrain.length!==2500
        ||!Array.isArray(seed)||!['structures','sites','sources','minerals'].every(k=>
            Array.isArray(input[k])&&input[k].every(o=>o&&valid(o.pos)))
        ||!seed.every(o=>o&&valid(o.pos)&&typeof o.type==='string'))return invalid;
    const all=input.structures.concat(input.sites,seed);
    const occupied=new Set(all.concat(input.sources,input.minerals,[input.controller])
        .map(o=>idx(o.pos)));
    const guard=access.create(input);
    const entries=[],blockers=[];
    const storage=all.find(o=>o.type==='storage');
    if(guard.check(seed))return {entries:[],blockers:['initialAccessBlocked']};
    // Tiles never used for these structures, computed once: walls, source and
    // mineral seats, and the controller's upgrade area.
    const excluded=new Uint8Array(2500);
    for(let i=0;i<2500;i++)if(input.terrain[i])excluded[i]=1;
    const mark=(c,r)=>{for(let y=Math.max(0,c.y-r);y<=Math.min(49,c.y+r);y++)
        for(let x=Math.max(0,c.x-r);x<=Math.min(49,c.x+r);x++)excluded[y*50+x]=1;};
    for(const s of input.sources)mark(s.pos,2);
    for(const m of input.minerals)mark(m.pos,1);
    mark(input.controller.pos,3);
    for(const spec of TARGETS) {
        const existing=all.concat(entries).filter(o=>o.type===spec.type
            && (o.my!==false || spec.type==='container')).length;
        const count=limits&&Number.isInteger(limits[spec.type])?Math.min(spec.count,limits[spec.type]):spec.count;
        for(let ordinal=existing+1;ordinal<=count;ordinal++) {
            const positions=[];
            const prior=all.concat(entries).filter(o=>o.type===spec.type).map(o=>o.pos);
            // Walking steps from the storage: haulers refill all of these from
            // there, and straight-line range ignores walls between pockets.
            const walk=storage?access.walkDistance(input,access.obstacles(input,seed.concat(entries)),storage.pos):null;
            for(let y=2;y<=47;y++)for(let x=2;x<=47;x++) {
                const p={x,y}, key=idx(p), d=range(p,input.anchor.pos);
                if(excluded[key]||d>spec.near||occupied.has(key))continue;
                const fromStorage=walk?walk[key]:d;
                if(walk && fromStorage>20)continue;
                if((spec.type==='factory'||spec.type==='powerSpawn') && fromStorage>8)continue;
                if(spec.type==='spawn' && (d<3||fromStorage>10))continue;
                const separation=prior.length?Math.min(...prior.map(q=>range(p,q))):6;
                if(spec.type==='tower' && separation<3)continue;
                let score=d*2+fromStorage*3;
                // Mild spread only: central towers cover every exit and refill fast.
                if(spec.type==='tower')score-=Math.min(separation,5)*3;
                else if(spec.type==='spawn')score-=Math.min(separation,7)*3;
                else if(spec.type==='factory'||spec.type==='powerSpawn')score+=fromStorage*8;
                positions.push({p,score});
            }
            positions.sort((a,b)=>a.score-b.score||a.p.y-b.p.y||a.p.x-b.p.x);
            let selected;
            for(const choice of positions.slice(0,64)){
                if(!guard.check(seed.concat(entries,{type:spec.type,pos:choice.p}))){selected=choice.p;break;}
            }
            if(!selected){blockers.push('noAccessibleSpace:'+spec.type+':'+ordinal);break;}
            entries.push({type:spec.type,purpose:'expansion:'+spec.type+':'+ordinal,
                pos:selected,priority:spec.priority});
            occupied.add(idx(selected));
        }
    }
    return {entries,blockers};
}
module.exports={planExpansion};
